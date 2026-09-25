import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DiaryQuestion } from '../entities/diary-question.entity';
import { DiaryQuestionService } from './diary-question.service';

/**
 * DiaryQuestionService 단위 테스트 (Phase 1 §10-4, 3 케이스)
 */
describe('DiaryQuestionService', () => {
  let service: DiaryQuestionService;

  const diaryQuestionRepoMock = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DiaryQuestionService,
        {
          provide: getRepositoryToken(DiaryQuestion),
          useValue: diaryQuestionRepoMock,
        },
      ],
    }).compile();

    service = moduleRef.get<DiaryQuestionService>(DiaryQuestionService);
  });

  function buildQuestion(
    overrides: Partial<DiaryQuestion> = {},
  ): DiaryQuestion {
    return {
      id: 'q-id',
      scope: 'patient',
      category: 'activity',
      text: '오늘 활동은?',
      isActive: true,
      orderHint: 0,
      createdAt: new Date(),
      ...overrides,
    } as DiaryQuestion;
  }

  it('케이스 1: scope=patient + category=activity → 후보 풀에서 랜덤 1개 반환', async () => {
    // Given
    const candidates = [
      buildQuestion({ id: 'q1' }),
      buildQuestion({ id: 'q2' }),
      buildQuestion({ id: 'q3' }),
    ];
    diaryQuestionRepoMock.find.mockResolvedValue(candidates);

    // When
    const result = await service.getTodayQuestion('patient', 'activity');

    // Then
    expect(diaryQuestionRepoMock.find).toHaveBeenCalledWith({
      where: {
        scope: 'patient',
        category: 'activity',
        locale: 'ko-KR',
        isActive: true,
      },
    });
    expect(['q1', 'q2', 'q3']).toContain(result.id);
  });

  it('케이스 2: scope=patient + category 누락 → BadRequestException', async () => {
    // Given / When / Then
    await expect(
      service.getTodayQuestion('patient', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(diaryQuestionRepoMock.find).not.toHaveBeenCalled();
  });

  it('케이스 3: 후보 풀이 비어있음 → NotFoundException (QUESTION_POOL_EMPTY)', async () => {
    // Given
    diaryQuestionRepoMock.find.mockResolvedValue([]);

    // When / Then
    await expect(
      service.getTodayQuestion('patient', 'moment'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('케이스 4 (보강): scope=caregiver → category 없이도 통과, where 조건에 category 미포함', async () => {
    // Given
    diaryQuestionRepoMock.find.mockResolvedValue([
      buildQuestion({ scope: 'caregiver', category: null }),
    ]);

    // When
    const result = await service.getTodayQuestion('caregiver');

    // Then
    expect(diaryQuestionRepoMock.find).toHaveBeenCalledWith({
      where: { scope: 'caregiver', locale: 'ko-KR', isActive: true },
    });
    expect(result.scope).toBe('caregiver');
  });

  it('케이스 5 (보강): getRandomPatientQuestionsByCategory는 3개 카테고리 모두에 대해 호출한다', async () => {
    // Given — 매 호출마다 1개씩 반환
    let callCount = 0;
    diaryQuestionRepoMock.find.mockImplementation(() => {
      callCount += 1;
      return Promise.resolve([buildQuestion({ id: `q${callCount}` })]);
    });

    // When
    const result = await service.getRandomPatientQuestionsByCategory();

    // Then
    expect(diaryQuestionRepoMock.find).toHaveBeenCalledTimes(3);
    expect(result.activity).toBeDefined();
    expect(result.moment).toBeDefined();
    expect(result.context).toBeDefined();
  });

  it('요청 로케일의 풀만 조회한다 — 다른 언어 문항으로 대체하지 않는다', async () => {
    diaryQuestionRepoMock.find.mockResolvedValue([]);

    await expect(
      service.getTodayQuestion('caregiver', undefined, 'en-US'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(diaryQuestionRepoMock.find).toHaveBeenCalledWith({
      where: { scope: 'caregiver', locale: 'en-US', isActive: true },
    });
  });
});
