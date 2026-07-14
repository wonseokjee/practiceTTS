import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProfileService, type CaregiverContext } from './profile.service';
import { MAX_FAMILY_MEMBERS } from './constants/profile.constants';
import type { CryptoService } from '../memory/services/crypto.service';
import type { FamilyMember } from './entities/family-member.entity';
import type { PatientProfile } from './entities/patient-profile.entity';
import type { Repository } from 'typeorm';

/**
 * ProfileService 단위 테스트.
 *
 * 핵심 회귀: 가족 서수(relationOrdinal) 채번이 삭제로 생긴 구멍 때문에 충돌하면
 * 두 사람이 같은 페르소나 토큰([아들2])을 갖게 되어 역치환의 결정성이 깨진다.
 */
describe('ProfileService', () => {
  const PATIENT_ID = 'patient-uuid';
  const PROFILE_ID = 'profile-uuid';
  const CAREGIVER_ID = 'caregiver-uuid';

  const caregiver: CaregiverContext = { patientId: PATIENT_ID };

  let service: ProfileService;
  let savedMember: Partial<FamilyMember> | null;
  let maxOrdinal: number | null; // nextOrdinal의 MAX 쿼리가 돌려줄 값
  let familyCount: number;

  const profileRepoMock = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const familyRepoMock = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const cryptoMock = {
    encrypt: jest.fn((s: string) => `enc:${s}`),
    decrypt: jest.fn((s: string) => s.replace(/^enc:/, '')),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    savedMember = null;
    maxOrdinal = null;
    familyCount = 0;

    profileRepoMock.findOne.mockImplementation(() =>
      Promise.resolve({
        id: PROFILE_ID,
        patientId: PATIENT_ID,
        caregiverId: CAREGIVER_ID,
        hometown: null,
        occupation: null,
        hobbies: [],
        significantPlaces: [],
        notes: null,
        updatedAt: new Date('2026-07-13T00:00:00.000Z'),
      } as unknown as PatientProfile),
    );

    familyRepoMock.count.mockImplementation(() => Promise.resolve(familyCount));
    familyRepoMock.find.mockResolvedValue([]);
    familyRepoMock.create.mockImplementation(
      (input: Partial<FamilyMember>) => input,
    );
    familyRepoMock.save.mockImplementation((input: Partial<FamilyMember>) => {
      savedMember = input;
      return Promise.resolve(input);
    });

    // nextOrdinal의 MAX(relationOrdinal) 쿼리를 재현하는 체이너블 목
    familyRepoMock.createQueryBuilder.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(() => Promise.resolve({ max: maxOrdinal })),
    }));

    service = new ProfileService(
      profileRepoMock as unknown as Repository<PatientProfile>,
      familyRepoMock as unknown as Repository<FamilyMember>,
      cryptoMock as unknown as CryptoService,
    );
  });

  describe('addFamilyMember — 서수 채번', () => {
    it('가족이 없으면 서수 1부터 시작한다', async () => {
      maxOrdinal = null; // MAX(NULL) → 가족 없음

      await service.addFamilyMember(caregiver, PATIENT_ID, {
        relation: 'son',
        name: '철수',
      });

      expect(savedMember?.relationOrdinal).toBe(1);
    });

    it('삭제로 구멍이 생겨도 서수를 재사용하지 않는다 (MAX+1)', async () => {
      // 아들1·아들2 중 아들1을 삭제한 상태: 남은 행은 1개(count=1)지만 MAX=2.
      // count+1이면 2가 되어 기존 아들2와 충돌한다 → MAX+1인 3이어야 한다.
      familyCount = 1;
      maxOrdinal = 2;

      await service.addFamilyMember(caregiver, PATIENT_ID, {
        relation: 'son',
        name: '영수',
      });

      expect(savedMember?.relationOrdinal).toBe(3);
    });

    it('Postgres가 MAX를 문자열로 돌려줘도 숫자로 채번한다', async () => {
      maxOrdinal = '4' as unknown as number;

      await service.addFamilyMember(caregiver, PATIENT_ID, {
        relation: 'son',
        name: '영수',
      });

      expect(savedMember?.relationOrdinal).toBe(5);
    });

    it('실명은 암호화되어 저장된다 (평문 미저장)', async () => {
      maxOrdinal = null;

      await service.addFamilyMember(caregiver, PATIENT_ID, {
        relation: 'grandson',
        name: '민준',
      });

      expect(savedMember?.name).toBe('enc:민준');
      expect(savedMember?.name).not.toBe('민준');
    });

    it('가족 상한을 넘으면 BadRequestException', async () => {
      familyCount = MAX_FAMILY_MEMBERS;

      await expect(
        service.addFamilyMember(caregiver, PATIENT_ID, {
          relation: 'son',
          name: '철수',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('upsert — 가족 목록 교체 시 서수 보존', () => {
    it('기존 구성원의 서수를 유지한다 (옛 시나리오 토큰이 딴 사람으로 복원되면 안 됨)', async () => {
      // 아들1=철수, 아들2=영수 상태에서 철수를 빼고 영수만 남겨 저장.
      // 서수를 1부터 재부여하면 영수가 [아들1]이 되고, 옛 시나리오의 [아들1](=철수)이
      // 영수 이름으로 복원된다 → 환자에게 엉뚱한 가족 이름 노출.
      familyRepoMock.find.mockResolvedValue([
        {
          relation: 'son',
          name: 'enc:철수',
          relationOrdinal: 1,
          gender: 'M',
        },
        {
          relation: 'son',
          name: 'enc:영수',
          relationOrdinal: 2,
          gender: 'M',
        },
      ] as unknown as FamilyMember[]);

      const savedEntities: Array<Partial<FamilyMember>> = [];
      familyRepoMock.save.mockImplementation(
        (input: Array<Partial<FamilyMember>>) => {
          savedEntities.push(...input);
          return Promise.resolve(input);
        },
      );
      profileRepoMock.save.mockImplementation((p: unknown) =>
        Promise.resolve({ ...(p as object), id: PROFILE_ID }),
      );

      await service.upsert(CAREGIVER_ID, caregiver, PATIENT_ID, {
        family: [{ relation: 'son', name: '영수' }],
      });

      // 영수는 서수 2를 그대로 유지해야 한다 (1로 당겨지면 안 됨)
      expect(savedEntities).toHaveLength(1);
      expect(savedEntities[0].relationOrdinal).toBe(2);
    });

    it('새 구성원에게는 쓰인 적 없는 서수를 준다 (재사용 금지)', async () => {
      familyRepoMock.find.mockResolvedValue([
        {
          relation: 'son',
          name: 'enc:철수',
          relationOrdinal: 2,
          gender: 'M',
        },
      ] as unknown as FamilyMember[]);

      const savedEntities: Array<Partial<FamilyMember>> = [];
      familyRepoMock.save.mockImplementation(
        (input: Array<Partial<FamilyMember>>) => {
          savedEntities.push(...input);
          return Promise.resolve(input);
        },
      );
      profileRepoMock.save.mockImplementation((p: unknown) =>
        Promise.resolve({ ...(p as object), id: PROFILE_ID }),
      );

      await service.upsert(CAREGIVER_ID, caregiver, PATIENT_ID, {
        family: [
          { relation: 'son', name: '철수' },
          { relation: 'son', name: '민수' }, // 신규
        ],
      });

      const byName = new Map(
        savedEntities.map((e) => [e.name, e.relationOrdinal]),
      );
      expect(byName.get('enc:철수')).toBe(2); // 유지
      expect(byName.get('enc:민수')).toBe(3); // MAX+1, 1을 재사용하지 않는다
    });
  });

  describe('소유권 검증', () => {
    it('연결되지 않은 환자면 ForbiddenException', async () => {
      const other: CaregiverContext = { patientId: 'another-patient' };

      await expect(
        service.addFamilyMember(other, PATIENT_ID, {
          relation: 'son',
          name: '철수',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('환자 연결이 없는 보호자면 ForbiddenException', async () => {
      const unlinked: CaregiverContext = { patientId: null };

      await expect(
        service.getProfile(unlinked, PATIENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
