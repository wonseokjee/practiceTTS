import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { QuizError, QuizErrorCode } from './errors/quiz.errors';
import { QUIZ_GENERATION_CLIENT } from './interfaces/IQuizGenerationClient';
import { QUIZ_SCORER } from './interfaces/IQuizScorer';
import { QuizService } from './quiz.service';

/**
 * QuizService 통합 비즈니스 로직 단위 테스트 (Plan §11 Phase 3).
 *
 * Repository/DataSource/Client/Scorer는 모두 jest mock으로 주입(실제 DB 없음).
 *
 * 검증 범위:
 *  - 자동 생성(generateForMemoryEntry): pending→ready 전이, 페이로드 화이트리스트,
 *    notes 0개/엔트리 없음 예외
 *  - 수동 생성(requestGeneration): 소유권/중복/정상 반환
 *  - getSetDetail: 권한/준비상태 예외 + 정답 은닉
 *  - submitAttempts: 채점/멱등/세션만료/유효성/완료-best upsert/미완료
 *  - getBestScore: null/값 반환
 */
describe('QuizService', () => {
  const PATIENT_ID = 'patient-uuid';
  const CAREGIVER_ID = 'caregiver-uuid';
  const MEMORY_ENTRY_ID = 'mem-uuid';
  const QUIZ_SET_ID = 'set-uuid';
  const SESSION_TOKEN = 'session-uuid';

  let service: QuizService;

  let quizSetRepo: ReturnType<typeof buildRepoMock>;
  let quizQuestionRepo: ReturnType<typeof buildRepoMock>;
  let quizAttemptRepo: ReturnType<typeof buildRepoMock>;
  let quizBestScoreRepo: ReturnType<typeof buildRepoMock>;
  let memoryEntryRepo: ReturnType<typeof buildRepoMock>;
  let patientMemoryNoteRepo: ReturnType<typeof buildRepoMock>;
  let generationClientMock: { generate: jest.Mock };
  let scorerMock: { isCorrect: jest.Mock; toScore: jest.Mock };

  function buildRepoMock() {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
  }

  /** MemoryEntry mock */
  function buildEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
    return {
      id: MEMORY_ENTRY_ID,
      caregiverId: CAREGIVER_ID,
      patientId: PATIENT_ID,
      isActive: true,
      photoUrl: '/uploads/a.jpg',
      targetWords: [],
      ...overrides,
    } as MemoryEntry;
  }

  /** PatientMemoryNote mock */
  function buildNote(overrides: Partial<PatientMemoryNote> = {}): PatientMemoryNote {
    return {
      id: 'note-1',
      memoryEntryId: MEMORY_ENTRY_ID,
      category: 'activity',
      orderIndex: 0,
      answerText: '공원 산책',
      ...overrides,
    } as PatientMemoryNote;
  }

  /** QuizSet mock */
  function buildSet(overrides: Partial<QuizSet> = {}): QuizSet {
    return {
      id: QUIZ_SET_ID,
      memoryEntryId: MEMORY_ENTRY_ID,
      patientId: PATIENT_ID,
      caregiverId: CAREGIVER_ID,
      generationStatus: 'ready',
      generationError: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      readyAt: new Date('2026-06-01T00:01:00.000Z'),
      ...overrides,
    } as QuizSet;
  }

  /** QuizQuestion mock */
  function buildQuestion(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
    return {
      id: 'q-1',
      quizSetId: QUIZ_SET_ID,
      orderIndex: 0,
      type: 'multiple_choice',
      prompt: '어디에 갔나요?',
      choices: ['공원', '바다'],
      correctAnswer: '공원',
      hintFirstChar: null,
      explanation: null,
      ...overrides,
    } as QuizQuestion;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    quizSetRepo = buildRepoMock();
    quizQuestionRepo = buildRepoMock();
    quizAttemptRepo = buildRepoMock();
    quizBestScoreRepo = buildRepoMock();
    memoryEntryRepo = buildRepoMock();
    patientMemoryNoteRepo = buildRepoMock();
    generationClientMock = { generate: jest.fn() };
    scorerMock = { isCorrect: jest.fn(), toScore: jest.fn() };

    // create는 입력을 그대로 반환하는 기본 동작
    quizSetRepo.create.mockImplementation((x: unknown) => x);
    quizQuestionRepo.create.mockImplementation((x: unknown) => x);
    quizAttemptRepo.create.mockImplementation((x: unknown) => x);
    quizBestScoreRepo.create.mockImplementation((x: unknown) => x);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: getRepositoryToken(QuizSet), useValue: quizSetRepo },
        {
          provide: getRepositoryToken(QuizQuestion),
          useValue: quizQuestionRepo,
        },
        { provide: getRepositoryToken(QuizAttempt), useValue: quizAttemptRepo },
        {
          provide: getRepositoryToken(QuizBestScore),
          useValue: quizBestScoreRepo,
        },
        { provide: getRepositoryToken(MemoryEntry), useValue: memoryEntryRepo },
        {
          provide: getRepositoryToken(PatientMemoryNote),
          useValue: patientMemoryNoteRepo,
        },
        { provide: getDataSourceToken(), useValue: { transaction: jest.fn() } },
        { provide: QUIZ_GENERATION_CLIENT, useValue: generationClientMock },
        { provide: QUIZ_SCORER, useValue: scorerMock },
      ],
    }).compile();

    service = moduleRef.get<QuizService>(QuizService);
  });

  // ─── 자동 생성 ─────────────────────────────────────────────────────
  describe('generateForMemoryEntry (자동 트리거)', () => {
    it('엔트리+노트 존재 시 pending 저장 → LLM 호출 → 질문 영속화 → ready로 update해야 한다', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(null); // 기존 set 없음
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: 'p',
            choices: ['a', 'b'],
            correctAnswer: 'a',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      expect(result.quizSetId).toBe(QUIZ_SET_ID);
      // pending 저장
      expect(quizSetRepo.save).toHaveBeenCalledTimes(1);
      expect(quizSetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ generationStatus: 'pending' }),
      );
      // 질문 영속화 + ready 전이
      expect(quizQuestionRepo.save).toHaveBeenCalledTimes(1);
      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationStatus: 'ready' }),
      );
    });

    it('LLM 페이로드에 보호자 사적 데이터(mood/reflection/wish)가 부재해야 한다 (Phase 3 필수)', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(
        buildEntry({ targetWords: ['바다'] }),
      );
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      generationClientMock.generate.mockResolvedValue({
        questions: [],
        model: 'm',
        fallbackUsed: false,
      });
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      const payload = generationClientMock.generate.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(payload).not.toHaveProperty('mood');
      expect(payload).not.toHaveProperty('caregiverReflection');
      expect(payload).not.toHaveProperty('caregiverWishMessage');
      // 허용 키만: patientNotes + targetWords + distribution
      expect(payload.patientNotes).toEqual([
        { category: 'activity', answerText: '공원 산책' },
      ]);
      expect(payload.targetWords).toEqual(['바다']);
      expect(payload.distribution).toBeDefined();
    });

    it('환자 노트가 0개이면 NO_PATIENT_NOTES 에러를 던져야 한다', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([]);

      await expect(
        service.generateForMemoryEntry(MEMORY_ENTRY_ID),
      ).rejects.toMatchObject({ code: QuizErrorCode.NO_PATIENT_NOTES });
      expect(generationClientMock.generate).not.toHaveBeenCalled();
    });

    it('엔트리가 없으면 MEMORY_ENTRY_NOT_FOUND 에러를 던져야 한다', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(null);

      await expect(
        service.generateForMemoryEntry(MEMORY_ENTRY_ID),
      ).rejects.toMatchObject({ code: QuizErrorCode.MEMORY_ENTRY_NOT_FOUND });
    });

    it('기존 set이 있고 force 미지정(자동)이면 LLM 호출 없이 기존 set을 반환해야 한다', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(buildSet());

      const result = await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      expect(result.quizSetId).toBe(QUIZ_SET_ID);
      expect(quizSetRepo.save).not.toHaveBeenCalled();
      expect(generationClientMock.generate).not.toHaveBeenCalled();
    });

    it('LLM 호출 실패 시 set을 failed로 update하고 에러를 재전파해야 한다', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      generationClientMock.generate.mockRejectedValue(
        new QuizError(QuizErrorCode.LLM_GENERATION_FAILED, '실패'),
      );
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      await expect(
        service.generateForMemoryEntry(MEMORY_ENTRY_ID),
      ).rejects.toMatchObject({ code: QuizErrorCode.LLM_GENERATION_FAILED });

      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationStatus: 'failed' }),
      );
    });
  });

  // ─── 수동 생성 ─────────────────────────────────────────────────────
  describe('requestGeneration (수동 트리거)', () => {
    it('소유권 불일치(entry.caregiverId≠caregiverId)이면 NOT_OWNER 에러를 던져야 한다', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(
        buildEntry({ caregiverId: 'other-caregiver' }),
      );

      await expect(
        service.requestGeneration(MEMORY_ENTRY_ID, CAREGIVER_ID, false),
      ).rejects.toMatchObject({ code: QuizErrorCode.NOT_OWNER });
    });

    it('기존 set이 있고 force=false이면 QUIZ_SET_ALREADY_EXISTS 에러를 던져야 한다', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(buildSet());

      await expect(
        service.requestGeneration(MEMORY_ENTRY_ID, CAREGIVER_ID, false),
      ).rejects.toMatchObject({
        code: QuizErrorCode.QUIZ_SET_ALREADY_EXISTS,
      });
    });

    it('정상 시 pending set 저장 후 {quizSetId, generationStatus:"pending"}를 즉시 반환해야 한다', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      // 백그라운드 runGeneration이 호출하는 의존성 — 즉시 resolve
      generationClientMock.generate.mockResolvedValue({
        questions: [],
        model: 'm',
        fallbackUsed: false,
      });
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.requestGeneration(
        MEMORY_ENTRY_ID,
        CAREGIVER_ID,
        false,
      );

      expect(result).toEqual({
        quizSetId: QUIZ_SET_ID,
        generationStatus: 'pending',
      });
      expect(quizSetRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getSetDetail ──────────────────────────────────────────────────
  describe('getSetDetail (풀이용 단건 조회)', () => {
    it('권한 불일치(patientId 다름)이면 FORBIDDEN 에러를 던져야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());

      await expect(
        service.getSetDetail(QUIZ_SET_ID, 'other-patient'),
      ).rejects.toMatchObject({ code: QuizErrorCode.FORBIDDEN });
    });

    it('status가 ready가 아니면 QUIZ_NOT_READY 에러를 던져야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );

      await expect(
        service.getSetDetail(QUIZ_SET_ID, PATIENT_ID),
      ).rejects.toMatchObject({ code: QuizErrorCode.QUIZ_NOT_READY });
    });

    it('set이 없으면 QUIZ_SET_NOT_FOUND 에러를 던져야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getSetDetail(QUIZ_SET_ID, PATIENT_ID),
      ).rejects.toMatchObject({ code: QuizErrorCode.QUIZ_SET_NOT_FOUND });
    });

    it('정상 조회 시 questions에 correctAnswer 필드가 부재해야 한다 (정답 은닉)', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizQuestionRepo.find.mockResolvedValue([
        buildQuestion(),
        buildQuestion({ id: 'q-2', type: 'fill_blank', correctAnswer: '비밀' }),
      ]);

      const result = await service.getSetDetail(QUIZ_SET_ID, PATIENT_ID);

      expect(result.questions).toHaveLength(2);
      for (const q of result.questions) {
        expect(q).not.toHaveProperty('correctAnswer');
        expect(q).not.toHaveProperty('explanation');
      }
      expect(result.memoryEntry.caregiverWishMessage).toBeNull();
    });
  });

  // ─── submitAttempts ────────────────────────────────────────────────
  describe('submitAttempts (답안 제출 + 채점)', () => {
    /** 5문제 세트 + dto 구성 헬퍼 */
    function fiveQuestions(): QuizQuestion[] {
      return Array.from({ length: 5 }, (_, i) =>
        buildQuestion({ id: `q-${i}`, orderIndex: i }),
      );
    }

    function buildDto(answers: SubmitAttemptDto['answers']): SubmitAttemptDto {
      return { sessionToken: SESSION_TOKEN, answers };
    }

    it('정답/오답을 scorer 결과대로 채점하고 저장해야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue([
        buildQuestion({ id: 'q-0' }),
        buildQuestion({ id: 'q-1' }),
      ]);
      quizAttemptRepo.find.mockResolvedValue([]); // 기존 attempt 없음
      scorerMock.isCorrect
        .mockReturnValueOnce(true) // q-0 정답
        .mockReturnValueOnce(false); // q-1 오답
      scorerMock.toScore.mockReturnValue(50);
      quizAttemptRepo.save.mockImplementation((x: Record<string, unknown>) =>
        Promise.resolve({ ...x }),
      );

      const result = await service.submitAttempts(
        QUIZ_SET_ID,
        PATIENT_ID,
        buildDto([
          { questionId: 'q-0', userAnswer: '공원' },
          { questionId: 'q-1', userAnswer: '바다' },
        ]),
      );

      expect(result.results).toEqual([
        { questionId: 'q-0', isCorrect: true, correctAnswer: '공원' },
        { questionId: 'q-1', isCorrect: false, correctAnswer: '공원' },
      ]);
      expect(quizAttemptRepo.save).toHaveBeenCalledTimes(2);
      // 2문제 세트 모두 답함 → 완료
      expect(result.completed).toBe(true);
    });

    it('멱등: 동일 (세션, questionId) 기존 attempt가 있으면 재채점/재저장하지 않아야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue([buildQuestion({ id: 'q-0' })]);
      // 기존 attempt: q-0 이미 정답 처리됨
      quizAttemptRepo.find.mockResolvedValue([
        {
          questionId: 'q-0',
          isCorrect: true,
          answeredAt: new Date(),
        },
      ]);
      scorerMock.toScore.mockReturnValue(100);

      const result = await service.submitAttempts(
        QUIZ_SET_ID,
        PATIENT_ID,
        buildDto([{ questionId: 'q-0', userAnswer: '다시 제출' }]),
      );

      expect(scorerMock.isCorrect).not.toHaveBeenCalled();
      expect(quizAttemptRepo.save).not.toHaveBeenCalled();
      expect(result.results[0].isCorrect).toBe(true);
    });

    it('세션 만료: 첫 answeredAt이 31분 전이면 SESSION_EXPIRED 에러를 던져야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue([buildQuestion({ id: 'q-0' })]);
      const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000);
      quizAttemptRepo.find.mockResolvedValue([
        { questionId: 'q-9', isCorrect: true, answeredAt: thirtyOneMinAgo },
      ]);

      await expect(
        service.submitAttempts(
          QUIZ_SET_ID,
          PATIENT_ID,
          buildDto([{ questionId: 'q-0', userAnswer: 'x' }]),
        ),
      ).rejects.toMatchObject({ code: QuizErrorCode.SESSION_EXPIRED });
    });

    it('set에 없는 questionId이면 INVALID_ANSWER_FORMAT 에러를 던져야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue([buildQuestion({ id: 'q-0' })]);
      quizAttemptRepo.find.mockResolvedValue([]);

      await expect(
        service.submitAttempts(
          QUIZ_SET_ID,
          PATIENT_ID,
          buildDto([{ questionId: 'unknown-q', userAnswer: 'x' }]),
        ),
      ).rejects.toMatchObject({ code: QuizErrorCode.INVALID_ANSWER_FORMAT });
    });

    it('5/5 완료 시 completed=true이고 best-score upsert(isNewBest=true)를 반환해야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue(fiveQuestions());
      quizAttemptRepo.find.mockResolvedValue([]);
      scorerMock.isCorrect.mockReturnValue(true);
      scorerMock.toScore.mockReturnValue(100);
      quizAttemptRepo.save.mockImplementation((x: Record<string, unknown>) =>
        Promise.resolve({ ...x }),
      );
      // best-score 신규 (없음 → 생성)
      quizBestScoreRepo.findOne.mockResolvedValue(null);
      quizBestScoreRepo.save.mockResolvedValue({});

      const result = await service.submitAttempts(
        QUIZ_SET_ID,
        PATIENT_ID,
        buildDto(
          Array.from({ length: 5 }, (_, i) => ({
            questionId: `q-${i}`,
            userAnswer: '공원',
          })),
        ),
      );

      expect(result.completed).toBe(true);
      expect(result.bestScore).toBe(100);
      expect(result.isNewBest).toBe(true);
      expect(quizBestScoreRepo.save).toHaveBeenCalledTimes(1);
    });

    it('미완료(4/5)이면 completed=false이고 best-score는 갱신하지 않아야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue(fiveQuestions());
      quizAttemptRepo.find.mockResolvedValue([]);
      scorerMock.isCorrect.mockReturnValue(true);
      scorerMock.toScore.mockReturnValue(80);
      quizAttemptRepo.save.mockImplementation((x: Record<string, unknown>) =>
        Promise.resolve({ ...x }),
      );

      const result = await service.submitAttempts(
        QUIZ_SET_ID,
        PATIENT_ID,
        buildDto(
          Array.from({ length: 4 }, (_, i) => ({
            questionId: `q-${i}`,
            userAnswer: '공원',
          })),
        ),
      );

      expect(result.completed).toBe(false);
      expect(result.bestScore).toBeUndefined();
      expect(quizBestScoreRepo.findOne).not.toHaveBeenCalled();
      expect(quizBestScoreRepo.save).not.toHaveBeenCalled();
    });

    it('완료했지만 기존 최고점이 더 높으면 isNewBest=false로 기존 점수를 유지해야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue([buildQuestion({ id: 'q-0' })]);
      quizAttemptRepo.find.mockResolvedValue([]);
      scorerMock.isCorrect.mockReturnValue(false);
      scorerMock.toScore.mockReturnValue(0); // 이번 세션 0점
      quizAttemptRepo.save.mockImplementation((x: Record<string, unknown>) =>
        Promise.resolve({ ...x }),
      );
      // 기존 최고점 100
      quizBestScoreRepo.findOne.mockResolvedValue({
        id: 'best-1',
        bestScore: 100,
      });

      const result = await service.submitAttempts(
        QUIZ_SET_ID,
        PATIENT_ID,
        buildDto([{ questionId: 'q-0', userAnswer: 'x' }]),
      );

      expect(result.completed).toBe(true);
      expect(result.isNewBest).toBe(false);
      expect(result.bestScore).toBe(100);
      expect(quizBestScoreRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── getBestScore ──────────────────────────────────────────────────
  describe('getBestScore (최고 점수 조회)', () => {
    it('최고점 기록이 없으면 bestScore=null을 반환해야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizBestScoreRepo.findOne.mockResolvedValue(null);

      const result = await service.getBestScore(QUIZ_SET_ID, PATIENT_ID);

      expect(result).toEqual({ quizSetId: QUIZ_SET_ID, bestScore: null });
    });

    it('최고점 기록이 있으면 점수와 achievedAt(ISO)을 반환해야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      const achievedAt = new Date('2026-06-05T09:00:00.000Z');
      quizBestScoreRepo.findOne.mockResolvedValue({
        bestScore: 80,
        achievedAt,
      });

      const result = await service.getBestScore(QUIZ_SET_ID, PATIENT_ID);

      expect(result.bestScore).toBe(80);
      expect(result.achievedAt).toBe(achievedAt.toISOString());
    });

    it('권한 불일치이면 FORBIDDEN 에러를 던져야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());

      await expect(
        service.getBestScore(QUIZ_SET_ID, 'other-patient'),
      ).rejects.toMatchObject({ code: QuizErrorCode.FORBIDDEN });
    });
  });

  // ─── listSets ──────────────────────────────────────────────────────
  describe('listSets (풀 수 있는 목록 조회)', () => {
    /** createQueryBuilder 체이닝 mock 헬퍼 — getMany 결과를 지정 */
    function buildQueryBuilder(getManyResult: unknown[]) {
      const qb = {
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        orderBy: jest.fn(() => qb),
        take: jest.fn(() => qb),
        getMany: jest.fn().mockResolvedValue(getManyResult),
      };
      return qb;
    }

    it('조회된 set이 없으면 빈 배열을 반환해야 한다', async () => {
      quizSetRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([]));

      const result = await service.listSets(PATIENT_ID, {});

      expect(result).toEqual([]);
    });

    it('set 목록을 요약 DTO(quizSetId/notePreview/bestScore 등)로 매핑해야 한다', async () => {
      const set = buildSet();
      quizSetRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([set]));
      patientMemoryNoteRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([buildNote()]),
      );
      memoryEntryRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([buildEntry()]),
      );
      quizBestScoreRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([{ quizSetId: QUIZ_SET_ID, bestScore: 60 }]),
      );

      const result = await service.listSets(PATIENT_ID, {});

      expect(result).toHaveLength(1);
      expect(result[0].quizSetId).toBe(QUIZ_SET_ID);
      expect(result[0].bestScore).toBe(60);
      expect(result[0].notePreview).toContain('공원 산책');
      expect(result[0].generationStatus).toBe('ready');
    });
  });
});
