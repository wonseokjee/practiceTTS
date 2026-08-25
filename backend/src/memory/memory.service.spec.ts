import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CreateMemoryEntryDto } from './dto/create-memory-entry.dto';
import { CaregiverReflection } from './entities/caregiver-reflection.entity';
import { MemoryEntry } from './entities/memory-entry.entity';
import { MoodEntry } from './entities/mood-entry.entity';
import { PatientMemoryNote } from './entities/patient-memory-note.entity';
import { MemoryEntryService } from './memory.service';
import { CryptoService } from './services/crypto.service';
import { FastApiClientService } from './services/fast-api-client.service';
import { FileStorageService } from './services/file-storage.service';
import { PersonaContextService } from '../profile/services/persona-context.service';

/**
 * MemoryEntryService.create() 트랜잭션 회귀 테스트 (Phase 1 §10-3)
 *
 * 검증 범위:
 *  - 3-step 정상 흐름 (mood + patientAnswers + caregiverAnswer + wish)
 *  - patientAnswers만 (사진 없음)
 *  - photo만 (patientAnswers=[]) — P1-N5=(b) 서비스 OR 검증 통과
 *  - 둘 다 없음 → BadRequestException
 *  - 소유권 위반 → ForbiddenException
 *  - 트랜잭션 실패 시 사진 cleanup 호출 (P1-N6=(a))
 *  - CaregiverReflection.isPrivate 강제 (외부 입력 무시)
 *  - 응답 DTO에 보호자 사적 데이터 부재 (보안 회귀)
 */
describe('MemoryEntryService.create() — 3-step 트랜잭션 회귀', () => {
  const CAREGIVER_ID = 'caregiver-uuid';
  const PATIENT_ID = 'patient-uuid';
  const QUESTION_UUID = 'question-uuid';

  let service: MemoryEntryService;

  // Mock repositories / data source
  const memoryEntryRepoMock = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const patientMemoryNoteRepoMock = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  // 트랜잭션 내부에서 manager.getRepository(...) 호출에 응답할 mock 저장소들
  const txMemoryRepo = { create: jest.fn(), save: jest.fn() };
  const txMoodRepo = { create: jest.fn(), save: jest.fn() };
  const txReflectionRepo = { create: jest.fn(), save: jest.fn() };
  const txPatientNoteRepo = { create: jest.fn(), save: jest.fn() };

  const managerMock: Partial<EntityManager> = {
    getRepository: jest.fn((entityClass: unknown) => {
      if (entityClass === MemoryEntry) {
        return txMemoryRepo as unknown as Repository<MemoryEntry>;
      }
      if (entityClass === MoodEntry) {
        return txMoodRepo as unknown as Repository<MoodEntry>;
      }
      if (entityClass === CaregiverReflection) {
        return txReflectionRepo as unknown as Repository<CaregiverReflection>;
      }
      if (entityClass === PatientMemoryNote) {
        return txPatientNoteRepo as unknown as Repository<PatientMemoryNote>;
      }
      throw new Error('Unexpected entity class in mock manager');
    }) as unknown as EntityManager['getRepository'],
  };

  const dataSourceMock = {
    transaction: jest.fn(
      <T>(cb: (m: EntityManager) => Promise<T>): Promise<T> =>
        cb(managerMock as EntityManager),
    ),
  };

  const fastApiClientMock = {
    tag: jest.fn(),
    mask: jest.fn(),
    generateScenario: jest.fn(),
  };

  // 프로필 미등록 기본값 — 개인화 생략(baseContext 그대로) 흐름을 재현
  const personaContextMock = {
    buildPersonaContext: jest.fn((_patientId: string, baseContext: string) =>
      Promise.resolve({
        tokenizedContext: baseContext,
        tokenMap: {},
      }),
    ),
    buildTokenMap: jest.fn(() => Promise.resolve({})),
    restorePersonaText: jest.fn((text: string) => text),
  };

  const cryptoServiceMock = {
    encrypt: jest.fn((s: string) => `enc:${s}`),
    decrypt: jest.fn((s: string) => s.replace(/^enc:/, '')),
  };

  const fileStorageServiceMock: {
    getPublicUrl: jest.Mock;
    delete?: jest.Mock;
  } = {
    getPublicUrl: jest.fn((name: string) => `/uploads/memory-images/${name}`),
    delete: jest.fn(() => Promise.resolve(undefined)),
  };

  beforeEach(async () => {
    // 각 테스트마다 mock 리셋
    jest.clearAllMocks();

    // 트랜잭션 mock 기본 동작 — cb 즉시 실행
    dataSourceMock.transaction.mockImplementation(
      <T>(cb: (m: EntityManager) => Promise<T>) =>
        cb(managerMock as EntityManager),
    );

    // 트랜잭션 내부 save 기본 동작 — 입력 그대로 반환 (id 부여)
    txMemoryRepo.create.mockImplementation((input: Partial<MemoryEntry>) => ({
      ...input,
    }));
    txMemoryRepo.save.mockImplementation((input: Partial<MemoryEntry>) =>
      Promise.resolve({
        id: 'new-entry-id',
        createdAt: new Date('2026-05-17T10:00:00.000Z'),
        ...input,
      }),
    );
    txMoodRepo.create.mockImplementation((input: unknown) => input);
    txMoodRepo.save.mockImplementation((input: unknown) =>
      Promise.resolve(input),
    );
    txReflectionRepo.create.mockImplementation((input: unknown) => input);
    txReflectionRepo.save.mockImplementation((input: unknown) =>
      Promise.resolve(input),
    );
    txPatientNoteRepo.create.mockImplementation((input: unknown) => input);
    txPatientNoteRepo.save.mockImplementation((input: unknown[]) =>
      Promise.resolve(input),
    );

    // FastAPI 기본 mock — tag/mask 호출되지 않을 것을 전제로 함
    fastApiClientMock.tag.mockResolvedValue(null);
    fastApiClientMock.mask.mockResolvedValue({ maskedText: 'masked' });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryEntryService,
        {
          provide: getRepositoryToken(MemoryEntry),
          useValue: memoryEntryRepoMock,
        },
        {
          provide: getRepositoryToken(PatientMemoryNote),
          useValue: patientMemoryNoteRepoMock,
        },
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: FastApiClientService, useValue: fastApiClientMock },
        { provide: CryptoService, useValue: cryptoServiceMock },
        { provide: FileStorageService, useValue: fileStorageServiceMock },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: PersonaContextService, useValue: personaContextMock },
      ],
    }).compile();

    service = moduleRef.get<MemoryEntryService>(MemoryEntryService);
  });

  function buildDto(
    overrides: Partial<CreateMemoryEntryDto> = {},
  ): CreateMemoryEntryDto {
    return {
      patientId: PATIENT_ID,
      mood: { level: 4 },
      patientAnswers: [
        {
          questionId: QUESTION_UUID,
          category: 'activity',
          answerText: '공원에서 산책',
        },
      ],
      ...overrides,
    } as CreateMemoryEntryDto;
  }

  function buildPhoto(filename = 'abc.jpg'): Express.Multer.File {
    return {
      filename,
      originalname: filename,
      mimetype: 'image/jpeg',
      size: 1024,
    } as Express.Multer.File;
  }

  it('케이스 1: 3-step 정상 — 모든 필드 + 사진 → 모두 저장 + Public DTO 반환', async () => {
    // Given
    const dto = buildDto({
      patientAnswers: [
        {
          questionId: QUESTION_UUID,
          category: 'activity',
          answerText: '공원',
        },
        {
          questionId: QUESTION_UUID,
          category: 'moment',
          answerText: '웃었어요',
        },
      ],
      caregiverAnswer: {
        questionId: QUESTION_UUID,
        answerText: '오늘은 힘들었다',
      },
      caregiverWishMessage: '사랑해요',
    });
    const photo = buildPhoto();

    // When
    const result = await service.create(CAREGIVER_ID, dto, photo, {
      patientId: PATIENT_ID,
    });

    // Then — 5종 row 저장 호출 검증
    expect(txMemoryRepo.save).toHaveBeenCalledTimes(1);
    expect(txMoodRepo.save).toHaveBeenCalledTimes(1);
    expect(txReflectionRepo.save).toHaveBeenCalledTimes(1);
    expect(txPatientNoteRepo.save).toHaveBeenCalledTimes(1);

    // Public DTO에 보호자 사적 데이터 부재
    expect('mood' in result).toBe(false);
    expect('caregiverReflection' in result).toBe(false);

    // caregiverWishMessage는 노출
    expect(result.caregiverWishMessage).toBe('사랑해요');
    expect(result.patientNotes).toHaveLength(2);
  });

  it('케이스 2: patientAnswers만 (사진/caregiverAnswer/wish 없음) → CaregiverReflection 저장 호출되지 않음', async () => {
    // Given
    const dto = buildDto();

    // When
    await service.create(CAREGIVER_ID, dto, undefined, {
      patientId: PATIENT_ID,
    });

    // Then
    expect(txMemoryRepo.save).toHaveBeenCalledTimes(1);
    expect(txMoodRepo.save).toHaveBeenCalledTimes(1);
    expect(txReflectionRepo.save).not.toHaveBeenCalled();
    expect(txPatientNoteRepo.save).toHaveBeenCalledTimes(1);
    // 사진 없음 → FastAPI tag 호출 없음
    expect(fastApiClientMock.tag).not.toHaveBeenCalled();
  });

  it('케이스 3: photo만 (patientAnswers=[]) → R2(b) 재해석 통과, patientNote 저장 0개', async () => {
    // Given
    const dto = buildDto({ patientAnswers: [] });
    const photo = buildPhoto();

    // When
    const result = await service.create(CAREGIVER_ID, dto, photo, {
      patientId: PATIENT_ID,
    });

    // Then
    expect(txMemoryRepo.save).toHaveBeenCalledTimes(1);
    expect(txMoodRepo.save).toHaveBeenCalledTimes(1);
    // patientAnswers=[] 이므로 save는 호출되지 않음 (헬퍼가 짧은 회로)
    expect(txPatientNoteRepo.save).not.toHaveBeenCalled();
    expect(result.patientNotes).toHaveLength(0);
  });

  it('케이스 4: patientAnswers=[] + photo 없음 → BadRequestException, transaction 미호출', async () => {
    // Given
    const dto = buildDto({ patientAnswers: [] });

    // When / Then
    await expect(
      service.create(CAREGIVER_ID, dto, undefined, {
        patientId: PATIENT_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(dataSourceMock.transaction).not.toHaveBeenCalled();
  });

  it('케이스 5: 소유권 위반 → ForbiddenException, transaction 미호출', async () => {
    // Given
    const dto = buildDto({ patientId: 'other-patient' });

    // When / Then
    await expect(
      service.create(CAREGIVER_ID, dto, undefined, {
        patientId: PATIENT_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(dataSourceMock.transaction).not.toHaveBeenCalled();
  });

  it('케이스 6: 트랜잭션 도중 실패 → 예외 전파 + 사진 cleanup 호출 (P1-N6=(a))', async () => {
    // Given — PatientMemoryNote.save에서 실패
    txPatientNoteRepo.save.mockRejectedValueOnce(new Error('DB FK 위반'));
    const dto = buildDto();
    const photo = buildPhoto('orphan-cleanup-target.jpg');

    // When / Then
    await expect(
      service.create(CAREGIVER_ID, dto, photo, { patientId: PATIENT_ID }),
    ).rejects.toThrow('DB FK 위반');

    expect(fileStorageServiceMock.delete).toHaveBeenCalledWith(
      'orphan-cleanup-target.jpg',
    );
  });

  it('케이스 7 (보안 회귀): 응답 DTO에 mood/caregiverReflection 부재', async () => {
    // Given
    const dto = buildDto({
      caregiverAnswer: {
        questionId: QUESTION_UUID,
        answerText: '사적 답변',
      },
    });

    // When
    const result = await service.create(CAREGIVER_ID, dto, undefined, {
      patientId: PATIENT_ID,
    });

    // Then
    expect(result).not.toHaveProperty('mood');
    expect(result).not.toHaveProperty('caregiverReflection');
  });

  it('케이스 8: CaregiverReflection.isPrivate가 항상 true로 강제된다 (외부 입력 무시)', async () => {
    // Given
    const dto = buildDto({
      caregiverAnswer: {
        questionId: QUESTION_UUID,
        answerText: '나의 답변',
      },
    });

    // When
    await service.create(CAREGIVER_ID, dto, undefined, {
      patientId: PATIENT_ID,
    });

    // Then — save에 전달된 객체의 isPrivate === true
    expect(txReflectionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isPrivate: true }),
    );
  });
});
