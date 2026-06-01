import {
  ConflictException,
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
  let userRepository: jest.Mocked<Pick<Repository<User>, 'createQueryBuilder' | 'findOne'>>;
  let dataSource: { transaction: jest.Mock };
  let jwtService: { sign: jest.Mock };

  beforeEach(() => {
    userRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
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
        service.login({ email: patient.email, password: 'whatever' }),
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
      await expect(service.verifyPatientModePin('cg3', '0000')).rejects.toThrow();
      await expect(service.verifyPatientModePin('cg3', '0000')).rejects.toThrow();
      await expect(service.verifyPatientModePin('cg3', '0000')).rejects.toThrow();
      // 디레이 윈도우 내 재시도 → 429
      await expect(
        service.verifyPatientModePin('cg3', '1234'),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
