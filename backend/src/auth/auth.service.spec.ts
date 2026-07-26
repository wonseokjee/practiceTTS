import {
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UNUSABLE_PASSWORD_HASH } from './auth.constants';
import { User } from './entities/user.entity';

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
  let dataSource: { transaction: jest.Mock };
  let jwtService: { sign: jest.Mock };

  beforeEach(() => {
    userRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((e: Partial<User>) => e as User),
      save: jest.fn(async (e: Partial<User>) => e as User),
    } as never;
    dataSource = { transaction: jest.fn() };
    jwtService = { sign: jest.fn(() => 'signed-token') };

    service = new AuthService(
      userRepository as unknown as Repository<User>,
      jwtService as unknown as JwtService,
      dataSource as unknown as DataSource,
    );
  });

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
      displayName: '카카오사용자',
    };

    it('기존 소셜 유저가 있으면 그대로 반환한다(중복 생성 없음)', async () => {
      const existing = { id: 'u1', authProvider: 'kakao' } as User;
      userRepository.findOne.mockResolvedValueOnce(existing);

      const result = await service.findOrCreateSocialUser(profile);

      expect(result).toBe(existing);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('신규면 patient_id=null 미완성 보호자를 만든다(온보딩 필요)', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(null) // (provider,id) 없음
        .mockResolvedValueOnce(null); // 이메일 미사용

      const result = await service.findOrCreateSocialUser(profile);

      expect(result.role).toBe('caregiver');
      expect(result.authProvider).toBe('kakao');
      expect(result.providerUserId).toBe('12345');
      expect(result.patientId).toBeNull();
      expect(result.passwordHash).toBeNull();
      expect(result.email).toBe('kko@test.com');
    });

    it('이메일이 이미 다른 계정에 있으면 병합하지 않고 email=null로 만든다', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(null) // (provider,id) 없음
        .mockResolvedValueOnce({ id: 'other' } as User); // 이메일 이미 사용중

      const result = await service.findOrCreateSocialUser(profile);

      expect(result.email).toBeNull();
      expect(result.authProvider).toBe('kakao');
    });

    it('이메일 UNIQUE 경합(사전체크 이후 선점) 시 email=null로 재시도해 생성한다', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(null) // (provider,id) 없음
        .mockResolvedValueOnce(null) // 사전 체크: 이메일 미사용
        .mockResolvedValueOnce(null); // catch 재조회: provider 행 없음 → 이메일 경합
      userRepository.save
        .mockRejectedValueOnce(
          new QueryFailedError('insert', [], { code: '23505' } as never),
        )
        .mockImplementationOnce(async (e: Partial<User>) => e as User);

      const result = await service.findOrCreateSocialUser(profile);

      expect(result.email).toBeNull(); // 재시도에서 이메일을 비웠다
      expect(userRepository.save).toHaveBeenCalledTimes(2);
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

  describe('일회용 코드 교환', () => {
    it('발급된 코드를 실제 JWT+user로 교환하고 1회만 유효하다', async () => {
      // 신규 소셜 유저 생성(코드 발급). email=null이라 이메일 충돌 조회는 생략되어
      // findOne은 (provider,id) 조회 1번만 호출된다.
      userRepository.findOne.mockResolvedValueOnce(null);
      userRepository.create.mockReturnValueOnce({
        id: 'u9',
        role: 'caregiver',
        patientId: null,
      } as User);
      userRepository.save.mockResolvedValueOnce({
        id: 'u9',
        role: 'caregiver',
        patientId: null,
      } as User);

      const code = await service.socialLoginToCode({
        provider: 'kakao',
        providerUserId: '999',
        email: null,
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
