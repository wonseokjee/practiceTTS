import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UNUSABLE_PASSWORD_HASH } from './auth.constants';
import { User } from './entities/user.entity';
import { SocialIdentity } from './entities/social-identity.entity';

/** createQueryBuilder 체인을 흉내내고 getOne 결과를 주입 */
function fakeQueryBuilder(result: User | null) {
  const qb: Record<string, unknown> = {};
  qb.addSelect = jest.fn(() => qb);
  qb.where = jest.fn(() => qb);
  qb.getOne = jest.fn(async () => result);
  return qb;
}

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<
    Pick<Repository<User>, 'createQueryBuilder' | 'findOne' | 'create' | 'save'>
  >;
  let identityRepository: jest.Mocked<
    Pick<Repository<SocialIdentity>, 'findOne' | 'find' | 'create' | 'save' | 'delete'>
  >;
  let dataSource: { transaction: jest.Mock };
  let jwtService: { sign: jest.Mock };

  beforeEach(() => {
    userRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((e: Partial<User>) => e as User),
      save: jest.fn(async (e: Partial<User>) => e as User),
    } as never;
    identityRepository = {
      findOne: jest.fn(),
      find: jest.fn(async () => [] as SocialIdentity[]),
      create: jest.fn((e: Partial<SocialIdentity>) => e as SocialIdentity),
      save: jest.fn(async (e: Partial<SocialIdentity>) => e as SocialIdentity),
      delete: jest.fn(async () => ({ affected: 1 })),
    } as never;
    dataSource = { transaction: jest.fn() };
    jwtService = { sign: jest.fn(() => 'signed-token') };

    service = new AuthService(
      userRepository as unknown as Repository<User>,
      identityRepository as unknown as Repository<SocialIdentity>,
      jwtService as unknown as JwtService,
      dataSource as unknown as DataSource,
    );
  });

  /**
   * findOrCreateSocialUser의 트랜잭션 흐름용 fakeManager.
   * getRepository(User)→userRepo, getRepository(SocialIdentity)→idRepo로 분기.
   */
  function socialManager(
    userRepo: Record<string, jest.Mock>,
    idRepo: Record<string, jest.Mock>,
  ) {
    return {
      getRepository: (entity: unknown) =>
        entity === User ? userRepo : idRepo,
    };
  }

  describe('register', () => {
    it('보호자+환자 2행을 생성·연결하고 환자는 로그인 불가 sentinel을 가진다', async () => {
      const created: Partial<User>[] = [];
      const fakeManager = {
        getRepository: () => ({
          create: (e: Partial<User>) => {
            created.push(e);
            return e;
          },
          save: async (e: Partial<User>) => e,
        }),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) => cb(fakeManager),
      );

      const result = await service.register({
        email: 'cg@test.com',
        password: 'password123',
        displayName: '보호자',
        patientDisplayName: '어르신',
        patientModePin: '1234',
      });

      const patient = created.find((e) => e.role === 'patient');
      const caregiver = created.find((e) => e.role === 'caregiver');
      expect(patient).toBeDefined();
      expect(caregiver).toBeDefined();
      expect(patient!.passwordHash).toBe(UNUSABLE_PASSWORD_HASH);
      expect(patient!.patientModePinHash).toBeNull();
      expect(patient!.email).toContain('local.invalid');
      // 보호자가 환자를 가리킨다
      expect(caregiver!.patientId).toBe(patient!.id);
      expect(result.accessToken).toBe('signed-token');
    });

    it('[누출 차단] register 응답에 passwordHash/patientModePinHash 미포함', async () => {
      const fakeManager = {
        getRepository: () => ({
          create: (e: Partial<User>) => e,
          save: async (e: Partial<User>) => e,
        }),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) => cb(fakeManager),
      );

      const result = await service.register({
        email: 'cg2@test.com',
        password: 'password123',
        displayName: '보호자',
        patientDisplayName: '어르신',
        patientModePin: '1234',
      });

      expect('passwordHash' in result.user).toBe(false);
      expect('patientModePinHash' in result.user).toBe(false);
      expect('patient' in result.user).toBe(false);
    });

    it('email UNIQUE 위반(23505) → ConflictException(409), orphan 미생성(트랜잭션 롤백)', async () => {
      // 트랜잭션 전체가 unique 위반으로 reject → 부분 저장 없음
      dataSource.transaction.mockRejectedValue(
        new QueryFailedError('insert', [], { code: '23505' } as never),
      );

      await expect(
        service.register({
          email: 'dup@test.com',
          password: 'password123',
          displayName: '보호자',
          patientDisplayName: '어르신',
          patientModePin: '1234',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('[조기 거부] role=patient 계정은 bcrypt 비교 없이 401', async () => {
      const patient = {
        id: 'p1',
        email: 'patient+x@local.invalid',
        role: 'patient',
        passwordHash: UNUSABLE_PASSWORD_HASH,
      } as User;
      userRepository.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder(patient) as never,
      );
      const compareSpy = jest.spyOn(bcrypt, 'compare');

      await expect(
        service.login({ email: patient.email!, password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(compareSpy).not.toHaveBeenCalled();
      compareSpy.mockRestore();
    });

    it('정상 보호자 로그인 → 토큰 발급', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      const caregiver = {
        id: 'cg1',
        email: 'cg@test.com',
        role: 'caregiver',
        displayName: '보호자',
        patientId: 'p1',
        passwordHash,
      } as User;
      userRepository.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder(caregiver) as never,
      );

      const result = await service.login({
        email: 'cg@test.com',
        password: 'password123',
      });
      expect(result.accessToken).toBe('signed-token');
      expect('passwordHash' in result.user).toBe(false);
    });
  });

  describe('verifyPatientModePin', () => {
    it('올바른 PIN → 통과', async () => {
      const pinHash = await bcrypt.hash('1234', 10);
      userRepository.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({
          id: 'cg1',
          patientModePinHash: pinHash,
        } as User) as never,
      );
      await expect(
        service.verifyPatientModePin('cg1', '1234'),
      ).resolves.toBeUndefined();
    });

    it('틀린 PIN → 401', async () => {
      const pinHash = await bcrypt.hash('1234', 10);
      userRepository.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({
          id: 'cg2',
          patientModePinHash: pinHash,
        } as User) as never,
      );
      await expect(
        service.verifyPatientModePin('cg2', '0000'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('연속 실패 시 점증 디레이로 429', async () => {
      const pinHash = await bcrypt.hash('1234', 10);
      userRepository.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({
          id: 'cg3',
          patientModePinHash: pinHash,
        } as User) as never,
      );
      // 3회 실패 → 디레이 발생 (PATIENT_MODE_PIN_RETRY_DELAYS_MS[3]=5초)
      await expect(
        service.verifyPatientModePin('cg3', '0000'),
      ).rejects.toThrow();
      await expect(
        service.verifyPatientModePin('cg3', '0000'),
      ).rejects.toThrow();
      await expect(
        service.verifyPatientModePin('cg3', '0000'),
      ).rejects.toThrow();
      // 디레이 윈도우 내 재시도 → 429
      await expect(
        service.verifyPatientModePin('cg3', '1234'),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('findOrCreateSocialUser', () => {
    const profile = {
      provider: 'kakao' as const,
      providerUserId: '12345',
      email: 'kko@test.com',
      emailVerified: true,
      displayName: '카카오사용자',
    };

    it('기존 identity가 있으면 연결된 유저를 반환한다(중복 생성 없음)', async () => {
      const user = { id: 'u1' } as User;
      identityRepository.findOne.mockResolvedValueOnce({
        user,
      } as SocialIdentity);

      const result = await service.findOrCreateSocialUser(profile);

      expect(result).toBe(user);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('검증된 이메일이 기존 보호자와 일치하면 자동 연결한다(새 계정 안 만듦)', async () => {
      identityRepository.findOne.mockResolvedValueOnce(null); // 외부: identity 없음
      const existingCaregiver = {
        id: 'cg1',
        role: 'caregiver',
        email: 'kko@test.com',
      } as User;
      const userRepo = {
        findOne: jest.fn().mockResolvedValueOnce(existingCaregiver),
        create: jest.fn(),
        save: jest.fn(),
      };
      const idRepo = {
        findOne: jest.fn().mockResolvedValueOnce(null), // 트랜잭션 내 재확인: 없음
        create: jest.fn((e: Partial<SocialIdentity>) => e),
        save: jest.fn(async (e: Partial<SocialIdentity>) => e),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) =>
          cb(socialManager(userRepo, idRepo)),
      );

      const result = await service.findOrCreateSocialUser(profile);

      expect(result).toBe(existingCaregiver);
      expect(userRepo.create).not.toHaveBeenCalled(); // 새 유저 생성 안 함
      expect(idRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'cg1',
          provider: 'kakao',
          providerUserId: '12345',
        }),
      );
    });

    it('환자 placeholder 계정에는 자동 연결하지 않고 새 계정을 만든다', async () => {
      identityRepository.findOne.mockResolvedValueOnce(null);
      const patientRecord = {
        id: 'p1',
        role: 'patient',
        email: 'kko@test.com',
      } as User;
      const userRepo = {
        // 두 번 조회된다: (1) 자동연결 후보 → 환자라 제외, (2) createSocialUser의
        // 이메일 사전체크 → 같은 이메일이 물려 있어 email을 비운다.
        findOne: jest.fn().mockResolvedValue(patientRecord),
        create: jest.fn((e: Partial<User>) => e),
        save: jest.fn(async (e: Partial<User>) => ({ id: 'new', ...e })),
      };
      const idRepo = {
        findOne: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn((e: Partial<SocialIdentity>) => e),
        save: jest.fn(async (e: Partial<SocialIdentity>) => e),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) =>
          cb(socialManager(userRepo, idRepo)),
      );

      const result = await service.findOrCreateSocialUser(profile);

      expect(result.role).toBe('caregiver'); // 새 보호자 계정
      // email이 이미 환자 레코드에 물려 있으므로 createSocialUser가 비운다
      expect(result.email).toBeNull();
      expect(userRepo.create).toHaveBeenCalled();
    });

    it('이메일이 미검증이면 자동 연결하지 않는다(자동연결 후보 조회 자체를 안 함)', async () => {
      identityRepository.findOne.mockResolvedValueOnce(null);
      const userRepo = {
        // createSocialUser의 이메일 사전체크만 호출된다(미사용 이메일)
        findOne: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn((e: Partial<User>) => e),
        save: jest.fn(async (e: Partial<User>) => ({ id: 'new', ...e })),
      };
      const idRepo = {
        findOne: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn((e: Partial<SocialIdentity>) => e),
        save: jest.fn(async (e: Partial<SocialIdentity>) => e),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) =>
          cb(socialManager(userRepo, idRepo)),
      );

      const result = await service.findOrCreateSocialUser({
        ...profile,
        emailVerified: false,
      });

      expect(result.role).toBe('caregiver');
      expect(result.email).toBe('kko@test.com'); // 미사용이라 그대로 보존
      // findOne이 딱 1번(이메일 사전체크)만 — 자동연결 후보 조회는 스킵됐다
      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('신규(이메일 없음)면 미완성 보호자를 만들고 identity를 연결한다', async () => {
      identityRepository.findOne.mockResolvedValueOnce(null);
      const userRepo = {
        findOne: jest.fn(),
        create: jest.fn((e: Partial<User>) => e),
        save: jest.fn(async (e: Partial<User>) => ({ id: 'new', ...e })),
      };
      const idRepo = {
        findOne: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn((e: Partial<SocialIdentity>) => e),
        save: jest.fn(async (e: Partial<SocialIdentity>) => e),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) =>
          cb(socialManager(userRepo, idRepo)),
      );

      const result = await service.findOrCreateSocialUser({
        ...profile,
        email: null,
        emailVerified: false,
      });

      expect(result.role).toBe('caregiver');
      expect(result.patientId).toBeNull();
      expect(result.passwordHash).toBeNull();
      expect(result.authProvider).toBe('kakao');
      expect(userRepo.findOne).not.toHaveBeenCalled(); // 이메일 없어 사전체크 스킵
      expect(idRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'kakao', providerUserId: '12345' }),
      );
    });

    it('동시 최초 로그인 경합(유니크 위반)은 롤백 후 이긴 유저를 반환한다', async () => {
      const winner = { id: 'winner' } as User;
      identityRepository.findOne
        .mockResolvedValueOnce(null) // 외부 사전조회: 없음
        .mockResolvedValueOnce({ user: winner } as SocialIdentity); // 경합 후 재조회
      dataSource.transaction.mockRejectedValueOnce(
        new QueryFailedError('insert', [], { code: '23505' } as never),
      );

      const result = await service.findOrCreateSocialUser({
        ...profile,
        emailVerified: false,
      });

      expect(result).toBe(winner);
    });
  });

  describe('completeOnboarding', () => {
    it('어르신 성함·PIN으로 환자 레코드를 만들고 연결한다', async () => {
      const social = { id: 'u1', patientId: null, role: 'caregiver' } as User;
      // 1) 초기 조회(미완성) 2) 트랜잭션 후 재조회
      userRepository.findOne.mockResolvedValueOnce(social);

      const created: Partial<User>[] = [];
      const fakeManager = {
        getRepository: () => ({
          create: (e: Partial<User>) => {
            created.push(e);
            return e;
          },
          save: async (e: Partial<User>) => e,
          // 조건부 갱신이 1행 잡혔다(경합 없음).
          update: jest.fn(async () => ({ affected: 1 })),
          findOne: async () =>
            ({
              id: 'u1',
              patientId: 'p-new',
              role: 'caregiver',
            }) as User,
        }),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) => cb(fakeManager),
      );

      const result = await service.completeOnboarding('u1', {
        patientDisplayName: '박순자',
        patientModePin: '1234',
      });

      const patient = created.find((e) => e.role === 'patient');
      expect(patient).toBeDefined();
      expect(patient!.displayName).toBe('박순자');
      expect(patient!.passwordHash).toBe(UNUSABLE_PASSWORD_HASH);
      expect(result.patientId).toBe('p-new');
      // needsOnboarding이 false로 뒤집힌다
      expect(result.needsOnboarding).toBe(false);
    });

    it('동시 온보딩 경합(조건부 갱신 0행)은 409로 롤백된다', async () => {
      // 사전 체크는 통과(patient_id=null)했지만, 트랜잭션 안 조건부 UPDATE가
      // 0행 → 다른 요청이 먼저 연결함 → 409(트랜잭션 롤백으로 고아 patient 없음).
      const social = { id: 'u1', patientId: null, role: 'caregiver' } as User;
      userRepository.findOne.mockResolvedValueOnce(social);
      const fakeManager = {
        getRepository: () => ({
          create: (e: Partial<User>) => e,
          save: async (e: Partial<User>) => e,
          update: jest.fn(async () => ({ affected: 0 })), // 경합 패배
          findOne: async () => null,
        }),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) => cb(fakeManager),
      );

      await expect(
        service.completeOnboarding('u1', {
          patientDisplayName: '박순자',
          patientModePin: '1234',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('이미 온보딩된 계정(patient_id 있음)은 409', async () => {
      userRepository.findOne.mockResolvedValueOnce({
        id: 'u1',
        patientId: 'already',
        role: 'caregiver',
      } as User);

      await expect(
        service.completeOnboarding('u1', {
          patientDisplayName: '박순자',
          patientModePin: '1234',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('보호자가 아닌 역할(therapist 등)은 403', async () => {
      userRepository.findOne.mockResolvedValueOnce({
        id: 't1',
        patientId: null,
        role: 'therapist',
      } as User);

      await expect(
        service.completeOnboarding('t1', {
          patientDisplayName: '박순자',
          patientModePin: '1234',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('수동 연결(linkSocialIdentity)', () => {
    const profile = {
      provider: 'google' as const,
      providerUserId: 'g1',
      email: 'e@test.com',
      emailVerified: true,
      displayName: '구글',
    };

    it('새 provider를 현재 유저에 연결한다', async () => {
      identityRepository.findOne
        .mockResolvedValueOnce(null) // 소셜계정 미사용
        .mockResolvedValueOnce(null); // 유저가 이 provider 미보유

      await service.linkSocialIdentity('u1', profile);

      expect(identityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          provider: 'google',
          providerUserId: 'g1',
        }),
      );
    });

    it('그 소셜계정이 이미 다른 유저에 연결돼 있으면 409', async () => {
      identityRepository.findOne.mockResolvedValueOnce({
        userId: 'other',
      } as SocialIdentity);

      await expect(
        service.linkSocialIdentity('u1', profile),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(identityRepository.save).not.toHaveBeenCalled();
    });

    it('같은 유저에 이미 연결된 소셜계정이면 멱등 성공(중복 저장 없음)', async () => {
      identityRepository.findOne.mockResolvedValueOnce({
        userId: 'u1',
      } as SocialIdentity);

      await service.linkSocialIdentity('u1', profile);

      expect(identityRepository.save).not.toHaveBeenCalled();
    });

    it('유저가 같은 provider를 이미 붙였으면 409(유저당 provider 1개)', async () => {
      identityRepository.findOne
        .mockResolvedValueOnce(null) // 소셜계정 미사용
        .mockResolvedValueOnce({ userId: 'u1', provider: 'google' } as SocialIdentity);

      await expect(
        service.linkSocialIdentity('u1', profile),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(identityRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('연결 해제(unlinkSocialIdentity)', () => {
    it('마지막 로그인 수단(소셜 1개·비번 없음)은 403으로 막는다', async () => {
      identityRepository.find.mockResolvedValueOnce([
        { provider: 'kakao', providerUserId: 'k1' },
      ] as SocialIdentity[]);
      userRepository.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({
          id: 'u1',
          role: 'caregiver',
          passwordHash: null,
        } as User) as never,
      );

      await expect(
        service.unlinkSocialIdentity('u1', 'kakao'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('두 개 연결 중 하나 해제 → 남은 목록 반환, 주 provider 재지정', async () => {
      identityRepository.find.mockResolvedValueOnce([
        { provider: 'kakao', providerUserId: 'k1' },
        { provider: 'google', providerUserId: 'g1' },
      ] as SocialIdentity[]);
      userRepository.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({
          id: 'u1',
          role: 'caregiver',
          passwordHash: null,
        } as User) as never,
      );
      const userRepo = {
        findOne: jest.fn(async () => ({ authProvider: 'kakao' }) as User),
        update: jest.fn(async () => ({ affected: 1 })),
      };
      const idRepo = { delete: jest.fn(async () => ({ affected: 1 })) };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) =>
          cb({
            getRepository: (entity: unknown) =>
              entity === User ? userRepo : idRepo,
          }),
      );

      const remaining = await service.unlinkSocialIdentity('u1', 'kakao');

      expect(remaining).toEqual(['google']);
      expect(idRepo.delete).toHaveBeenCalledWith({
        userId: 'u1',
        provider: 'kakao',
      });
      // 주 provider가 방금 뺀 kakao였으므로 남은 google로 재지정
      expect(userRepo.update).toHaveBeenCalledWith(
        { id: 'u1' },
        { authProvider: 'google', providerUserId: 'g1' },
      );
    });

    it('연결되지 않은 provider 해제는 404', async () => {
      identityRepository.find.mockResolvedValueOnce([
        { provider: 'kakao', providerUserId: 'k1' },
      ] as SocialIdentity[]);

      await expect(
        service.unlinkSocialIdentity('u1', 'google'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('연결/병합 시작 코드(issue/redeemLinkCode)', () => {
    it('발급한 코드를 {userId,mode}로 1회 교환하고, 재사용/무효는 null', () => {
      const code = service.issueLinkCode('u7'); // 기본 link
      expect(service.redeemLinkCode(code)).toEqual({
        userId: 'u7',
        mode: 'link',
      });
      expect(service.redeemLinkCode(code)).toBeNull(); // 1회 소비
      expect(service.redeemLinkCode('nope')).toBeNull();
    });

    it('merge 모드 코드도 발급·교환된다', () => {
      const code = service.issueLinkCode('u8', 'merge');
      expect(service.redeemLinkCode(code)).toEqual({
        userId: 'u8',
        mode: 'merge',
      });
    });
  });

  describe('계정 병합(mergeAccounts)', () => {
    const profile = {
      provider: 'google' as const,
      providerUserId: 'g1',
      email: 'e@test.com',
      emailVerified: true,
      displayName: '구글',
    };

    function mergeManager(
      idRepo: Record<string, jest.Mock>,
      userRepo: Record<string, jest.Mock>,
    ) {
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) =>
          cb({
            getRepository: (entity: unknown) =>
              entity === User ? userRepo : idRepo,
          }),
      );
    }

    it('빈 소스 계정을 기존 계정에 흡수한다(신원 이전 + 소스 삭제)', async () => {
      identityRepository.findOne.mockResolvedValueOnce({
        user: { id: 'A' },
      } as SocialIdentity); // 대상 = 기존 계정 A
      userRepository.findOne.mockResolvedValueOnce({
        id: 'C',
        patientId: null,
      } as User); // 소스 = 빈 신규 C

      const idRepo = {
        find: jest
          .fn()
          .mockResolvedValueOnce([{ provider: 'google', id: 'ti1' }]) // A의 신원
          .mockResolvedValueOnce([{ provider: 'kakao', id: 'si1' }]), // C의 신원
        update: jest.fn(async () => ({ affected: 1 })),
      };
      const userRepo = { delete: jest.fn(async () => ({ affected: 1 })) };
      mergeManager(idRepo, userRepo);

      const res = await service.mergeAccounts('C', profile);

      expect(res).toEqual({ targetUserId: 'A' });
      // C의 카카오 신원을 A로 이전
      expect(idRepo.update).toHaveBeenCalledWith({ id: 'si1' }, { userId: 'A' });
      // 빈 소스 삭제
      expect(userRepo.delete).toHaveBeenCalledWith({ id: 'C' });
    });

    it('그 로그인으로 가입된 기존 계정이 없으면 404(신규 생성 안 함)', async () => {
      identityRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.mergeAccounts('C', profile),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('같은 계정으로 로그인하면 409', async () => {
      identityRepository.findOne.mockResolvedValueOnce({
        user: { id: 'C' },
      } as SocialIdentity);

      await expect(
        service.mergeAccounts('C', profile),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('데이터 있는 소스(patient_id 있음)는 병합 불가 409', async () => {
      identityRepository.findOne.mockResolvedValueOnce({
        user: { id: 'A' },
      } as SocialIdentity);
      userRepository.findOne.mockResolvedValueOnce({
        id: 'C',
        patientId: 'p1',
      } as User);

      await expect(
        service.mergeAccounts('C', profile),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('대상이 이미 가진 provider는 이전하지 않는다(소스와 함께 삭제)', async () => {
      identityRepository.findOne.mockResolvedValueOnce({
        user: { id: 'A' },
      } as SocialIdentity);
      userRepository.findOne.mockResolvedValueOnce({
        id: 'C',
        patientId: null,
      } as User);

      const idRepo = {
        find: jest
          .fn()
          .mockResolvedValueOnce([{ provider: 'kakao', id: 'ti1' }]) // A가 이미 카카오 보유
          .mockResolvedValueOnce([{ provider: 'kakao', id: 'si1' }]), // C도 카카오
        update: jest.fn(),
      };
      const userRepo = { delete: jest.fn(async () => ({ affected: 1 })) };
      mergeManager(idRepo, userRepo);

      await service.mergeAccounts('C', profile);

      expect(idRepo.update).not.toHaveBeenCalled(); // 중복이라 이전 안 함
      expect(userRepo.delete).toHaveBeenCalledWith({ id: 'C' });
    });
  });

  describe('일회용 코드 교환', () => {
    it('발급된 코드를 실제 JWT+user로 교환하고 1회만 유효하다', async () => {
      // 신규 소셜 유저 생성(코드 발급). email=null이라 이메일 사전체크는 생략된다.
      identityRepository.findOne.mockResolvedValueOnce(null); // 외부: identity 없음
      const newUser = { id: 'u9', role: 'caregiver', patientId: null } as User;
      const userRepo = {
        findOne: jest.fn(),
        create: jest.fn(() => newUser),
        save: jest.fn(async () => newUser),
      };
      const idRepo = {
        findOne: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn((e: Partial<SocialIdentity>) => e),
        save: jest.fn(async (e: Partial<SocialIdentity>) => e),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<unknown>) =>
          cb(socialManager(userRepo, idRepo)),
      );

      const code = await service.socialLoginToCode({
        provider: 'kakao',
        providerUserId: '999',
        email: null,
        emailVerified: false,
        displayName: '카카오',
      });
      expect(typeof code).toBe('string');

      // 교환 시 user 재조회
      userRepository.findOne.mockResolvedValueOnce({
        id: 'u9',
        role: 'caregiver',
        patientId: null,
      } as User);

      const redeemed = await service.redeemOneTimeCode(code);
      expect(redeemed.accessToken).toBe('signed-token');
      expect(redeemed.user.id).toBe('u9');

      // 재사용 불가(1회 소비)
      await expect(service.redeemOneTimeCode(code)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('유효하지 않은 코드는 401', async () => {
      await expect(service.redeemOneTimeCode('nope')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
