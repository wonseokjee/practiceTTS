import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitQabResultsDto } from './dto/submit-qab-results.dto';
import { QabResult } from './entities/qab-result.entity';
import { QabSessionCompletion } from './entities/qab-session-completion.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { SkillLevel } from './entities/skill-level.entity';
import { QAB_MANIFEST_VERSION, QAB_SUBTESTS } from './constants/qab-subtest';
import { QuizError, QuizErrorCode } from './errors/quiz.errors';
import { QUIZ_GENERATION_CLIENT } from './interfaces/IQuizGenerationClient';
import { QUIZ_SCORER } from './interfaces/IQuizScorer';
import { WISH_CONVERSION_CLIENT } from './interfaces/IWishConversionClient';
import { FastApiClientService } from '../memory/services/fast-api-client.service';
import { PersonaContextService } from '../profile/services/persona-context.service';
import type { PersonaSource, ProfileService } from '../profile/profile.service';
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
  let qabResultRepo: ReturnType<typeof buildRepoMock>;
  let skillLevelRepo: ReturnType<typeof buildRepoMock>;
  let qabSessionCompletionRepo: ReturnType<typeof buildRepoMock>;
  /** QAB 결과 INSERT에 넘긴 행들 (트랜잭션 쿼리빌더 mock이 채운다) */
  let insertedValues: unknown[];
  /** orIgnore() 호출 여부 — 멱등이 DB 수준(ON CONFLICT)인지 확인용 */
  let orIgnoreCalls: boolean[];
  let memoryEntryRepo: ReturnType<typeof buildRepoMock>;
  let patientMemoryNoteRepo: ReturnType<typeof buildRepoMock>;
  let generationClientMock: { generate: jest.Mock };
  let scorerMock: { isCorrect: jest.Mock; toScore: jest.Mock };
  let wishClientMock: { convert: jest.Mock };

  // 페르소나는 목이 아니라 실제 구현을 쓴다(스텁 프로필 소스만 주입).
  // 토큰화·역치환이 실제로 도는지 검증해야 PII 경계가 보장되기 때문.
  let personaSource: PersonaSource | null;
  let personaContextMock: PersonaContextService;

  // /mask 목 — 기본은 입력을 그대로 돌려준다(마스킹 통과).
  let fastApiClientMock: { mask: jest.Mock };

  function buildRepoMock() {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      increment: jest.fn(),
      upsert: jest.fn(),
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
  function buildNote(
    overrides: Partial<PatientMemoryNote> = {},
  ): PatientMemoryNote {
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
    insertedValues = [];
    orIgnoreCalls = [];

    // 기본값: 프로필 미등록 → 개인화 생략(원문 그대로 통과)
    personaSource = null;
    personaContextMock = new PersonaContextService({
      getPersonaSource: jest.fn(() => Promise.resolve(personaSource)),
    } as unknown as ProfileService);

    fastApiClientMock = {
      mask: jest.fn((text: string) => Promise.resolve({ maskedText: text })),
    };

    quizSetRepo = buildRepoMock();
    quizQuestionRepo = buildRepoMock();
    quizAttemptRepo = buildRepoMock();
    quizBestScoreRepo = buildRepoMock();
    qabResultRepo = buildRepoMock();
    skillLevelRepo = buildRepoMock();
    qabSessionCompletionRepo = buildRepoMock();
    memoryEntryRepo = buildRepoMock();
    patientMemoryNoteRepo = buildRepoMock();
    generationClientMock = { generate: jest.fn() };
    scorerMock = { isCorrect: jest.fn(), toScore: jest.fn() };
    wishClientMock = { convert: jest.fn() };

    // create는 입력을 그대로 반환하는 기본 동작
    quizSetRepo.create.mockImplementation((x: unknown) => x);
    quizQuestionRepo.create.mockImplementation((x: unknown) => x);
    quizAttemptRepo.create.mockImplementation((x: unknown) => x);
    quizBestScoreRepo.create.mockImplementation((x: unknown) => x);
    qabResultRepo.create.mockImplementation((x: unknown) => x);

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
        { provide: getRepositoryToken(QabResult), useValue: qabResultRepo },
        { provide: getRepositoryToken(SkillLevel), useValue: skillLevelRepo },
        {
          provide: getRepositoryToken(QabSessionCompletion),
          useValue: qabSessionCompletionRepo,
        },
        { provide: getRepositoryToken(MemoryEntry), useValue: memoryEntryRepo },
        {
          provide: getRepositoryToken(PatientMemoryNote),
          useValue: patientMemoryNoteRepo,
        },
        {
          provide: getDataSourceToken(),
          useValue: {
            // 트랜잭션 콜백을 실제로 실행하고, manager.getRepository(QuizSet)는
            // 동일한 quizSetRepo mock을 반환하여 기존 assertion(save/create/delete)을 유지한다.
            transaction: jest.fn(
              <T>(cb: (m: Record<string, unknown>) => T): T =>
                cb({
                  getRepository: (entity: unknown) => {
                    if (entity === QuizSet) {
                      return quizSetRepo;
                    }
                    if (entity === QuizQuestion) {
                      return quizQuestionRepo;
                    }
                    throw new Error('예상치 못한 엔티티: 트랜잭션 mock');
                  },
                  // saveQabResults 경로: manager.save(QabResult, rows)는 동일한
                  // qabResultRepo mock으로 위임해 기존 assertion을 유지한다.
                  save: (entity: unknown, rows: unknown): unknown => {
                    if (entity === QabResult) {
                      return qabResultRepo.save(rows);
                    }
                    throw new Error('예상치 못한 엔티티: 트랜잭션 save mock');
                  },
                  // 레벨 재계산: 기본은 행 없음(콜드스타트) + 빈 윈도우 → 레벨 불변.
                  findOne: (entity: unknown, opts: unknown): unknown => {
                    if (entity === SkillLevel) {
                      return skillLevelRepo.findOne(opts);
                    }
                    throw new Error(
                      '예상치 못한 엔티티: 트랜잭션 findOne mock',
                    );
                  },
                  // 두 경로가 이 빌더를 쓴다:
                  //  (1) QAB 결과 INSERT ... ON CONFLICT DO NOTHING (insert 체인)
                  //  (2) 레벨 재계산 윈도우 조회 (select 체인)
                  // insert의 execute()는 qabResultRepo.save로 위임해 "어떤 행을
                  // 넣으려 했나" assertion을 그대로 살린다. orIgnore는 별도 spy로
                  // 노출해, 멱등이 DB 수준에서 보장되는지 테스트가 확인할 수 있게 한다.
                  createQueryBuilder: () => ({
                    select: jest.fn().mockReturnThis(),
                    where: jest.fn().mockReturnThis(),
                    andWhere: jest.fn().mockReturnThis(),
                    orderBy: jest.fn().mockReturnThis(),
                    addOrderBy: jest.fn().mockReturnThis(),
                    limit: jest.fn().mockReturnThis(),
                    getRawMany: jest.fn().mockResolvedValue([]),
                    insert: jest.fn().mockReturnThis(),
                    into: jest.fn().mockReturnThis(),
                    values: jest.fn(function (this: unknown, rows: unknown) {
                      insertedValues.push(rows);
                      return this;
                    }),
                    orIgnore: jest.fn(function (this: unknown) {
                      orIgnoreCalls.push(true);
                      return this;
                    }),
                    execute: jest.fn((): unknown =>
                      qabResultRepo.save(
                        insertedValues[insertedValues.length - 1],
                      ),
                    ),
                  }),
                  upsert: (
                    entity: unknown,
                    values: unknown,
                    conflict: unknown,
                  ): unknown => {
                    if (entity === SkillLevel) {
                      return skillLevelRepo.upsert(values, conflict);
                    }
                    if (entity === QabSessionCompletion) {
                      return qabSessionCompletionRepo.upsert(values, conflict);
                    }
                    throw new Error('예상치 못한 엔티티: 트랜잭션 upsert mock');
                  },
                }),
            ),
          },
        },
        { provide: QUIZ_GENERATION_CLIENT, useValue: generationClientMock },
        { provide: QUIZ_SCORER, useValue: scorerMock },
        { provide: WISH_CONVERSION_CLIENT, useValue: wishClientMock },
        { provide: PersonaContextService, useValue: personaContextMock },
        { provide: FastApiClientService, useValue: fastApiClientMock },
      ],
    }).compile();

    service = moduleRef.get<QuizService>(QuizService);
  });

  // ─── 페르소나 개인화 (PII 경계) ──────────────────────────────────
  describe('generateForMemoryEntry — 페르소나 토큰화/역치환', () => {
    /** 프로필(손자=민준, 고향=강릉)이 등록된 상태를 구성한다 */
    function arrangeWithProfile(): void {
      personaSource = {
        hometown: '강릉',
        occupation: null,
        hobbies: [],
        significantPlaces: [],
        family: [
          {
            relation: 'grandson',
            name: '민준',
            gender: 'M',
            relationOrdinal: 1,
          },
        ],
      };
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([
        buildNote({ answerText: '민준이랑 강릉 바다에 다녀왔어요' }),
      ]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });
    }

    it('가족 실명·지명이 LLM 페이로드에 나가지 않는다 (토큰만 전달)', async () => {
      arrangeWithProfile();
      // 이 테스트들의 관심사는 LLM에 나간 페이로드다. 다만 문항이 0개면
      // "0문항 → failed" 가드에 걸리므로 통과용 문항 1개를 돌려준다.
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 했나요?',
            choices: ['산책', '독서'],
            correctAnswer: '산책',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      const sent = JSON.stringify(
        generationClientMock.generate.mock.calls[0][0],
      );
      expect(sent).not.toContain('민준');
      expect(sent).not.toContain('강릉');
      expect(sent).toContain('[손자1]');
      expect(sent).toContain('[장소1]');
    });

    it('LLM이 돌려준 토큰은 실명으로 역치환되어 저장된다', async () => {
      arrangeWithProfile();
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '[손자1]와 어디에 갔나요?',
            choices: ['[장소1]', '서울'],
            correctAnswer: '[장소1]',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      const saved = quizQuestionRepo.create.mock.calls[0][0] as {
        prompt: string;
        choices: string[];
        correctAnswer: string;
      };
      expect(saved.prompt).toBe('민준와 어디에 갔나요?');
      expect(saved.choices).toEqual(['강릉', '서울']);
      expect(saved.correctAnswer).toBe('강릉');
      // 토큰이 환자에게 그대로 노출되면 안 된다
      expect(JSON.stringify(saved)).not.toContain('[손자');
      expect(JSON.stringify(saved)).not.toContain('[장소');
    });

    it('토큰이 훼손된 문항([___1])은 저장하지 않고 제외한다', async () => {
      // 실제 관측된 실패: LLM이 빈칸을 토큰 안쪽에 뚫어 [손자1] → [___1]이 되면
      // 역치환도 라벨 폴백도 걸리지 않아 찌꺼기가 환자 화면에 노출된다.
      arrangeWithProfile();
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '[손자1]과 어디에 갔나요?',
            choices: ['[장소1]', '서울'],
            correctAnswer: '[장소1]',
            hintFirstChar: null,
          },
          {
            type: 'multiple_choice',
            prompt: '[___1]이랑 바다에 갔어요',
            choices: ['조개', '파도'],
            correctAnswer: '조개',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      // 정상 문항 1개만 저장된다
      expect(quizQuestionRepo.create).toHaveBeenCalledTimes(1);
      const saved = quizQuestionRepo.create.mock.calls[0][0] as {
        prompt: string;
      };
      expect(saved.prompt).toBe('민준과 어디에 갔나요?');
    });

    it('마스킹 라벨(Family_F1/Place_1)이 남은 문항은 환자에게 노출하지 않는다', async () => {
      // 프로필에 없는 이름·장소는 /mask가 Family_F1/Place_1로 바꾼다. 퀴즈 LLM이
      // 그 라벨을 문제에 그대로 쓰면 환자는 "Family_F1과 어디에 갔나요?"를 본다.
      // 대괄호가 없어 토큰 잔재 검사에는 안 걸리므로 별도로 막아야 한다.
      arrangeWithProfile();
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '[손자1]과 어디에 갔나요?',
            choices: ['바다', '서울'],
            correctAnswer: '바다',
            hintFirstChar: null,
          },
          {
            type: 'multiple_choice',
            prompt: 'Family_F1과 무엇을 했나요?',
            choices: ['Place_1', '공원'],
            correctAnswer: 'Place_1',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      expect(quizQuestionRepo.create).toHaveBeenCalledTimes(1);
      const saved = quizQuestionRepo.create.mock.calls[0][0] as {
        prompt: string;
      };
      expect(saved.prompt).toBe('민준과 어디에 갔나요?');
    });

    it('프로필이 없어도 마스킹 라벨 문항은 제외한다', async () => {
      // 마스킹 라벨은 프로필 등록 여부와 무관하게 생긴다 → 잔재 검사는 항상 돌아야 한다
      personaSource = null;
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 주웠나요?',
            choices: ['조개', '돌'],
            correctAnswer: '조개',
            hintFirstChar: null,
          },
          {
            type: 'multiple_choice',
            prompt: 'Place_1에 갔나요?',
            choices: ['네', '아니오'],
            correctAnswer: '네',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      expect(quizQuestionRepo.create).toHaveBeenCalledTimes(1);
    });

    it('쓸 만한 문항이 0개면 ready로 두지 않고 failed로 마감한다', async () => {
      // 0문항 set을 ready로 두면 환자는 문제 없는 퀴즈를 열고 완료조차 못 한다.
      arrangeWithProfile();
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: 'Family_F1과 어디에?',
            choices: ['Place_1', 'Place_2'],
            correctAnswer: 'Place_1',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });

      await expect(
        service.generateForMemoryEntry(MEMORY_ENTRY_ID),
      ).rejects.toThrow();

      expect(quizQuestionRepo.create).not.toHaveBeenCalled();
      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationStatus: 'failed' }),
      );
    });

    it('프로필 미등록이면 원문을 그대로 전달하고 생성은 계속된다', async () => {
      personaSource = null; // 미등록
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([
        buildNote({ answerText: '민준이랑 바다에 갔어요' }),
      ]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });
      // 이 테스트들의 관심사는 LLM에 나간 페이로드다. 다만 문항이 0개면
      // "0문항 → failed" 가드에 걸리므로 통과용 문항 1개를 돌려준다.
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 했나요?',
            choices: ['산책', '독서'],
            correctAnswer: '산책',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      const payload = generationClientMock.generate.mock.calls[0][0] as {
        patientNotes: Array<{ answerText: string }>;
      };
      expect(payload.patientNotes[0].answerText).toBe('민준이랑 바다에 갔어요');
    });
  });

  // ─── 마스킹 (프로필 밖 PII) ──────────────────────────────────────
  describe('generateForMemoryEntry — /mask 마스킹', () => {
    function arrangeNotes(answerText: string): void {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote({ answerText })]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });
      // 이 테스트들의 관심사는 LLM에 나간 페이로드다. 다만 문항이 0개면
      // "0문항 → failed" 가드에 걸리므로 통과용 문항 1개를 돌려준다.
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 했나요?',
            choices: ['산책', '독서'],
            correctAnswer: '산책',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });
    }

    it('노트를 /mask에 태운 뒤 마스킹된 텍스트를 LLM에 보낸다', async () => {
      arrangeNotes('서울 강남구 삼성병원에 다녀왔어요');
      fastApiClientMock.mask.mockResolvedValue({
        maskedText: '[장소]에 다녀왔어요',
      });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      expect(fastApiClientMock.mask).toHaveBeenCalledWith(
        '서울 강남구 삼성병원에 다녀왔어요',
        MEMORY_ENTRY_ID,
      );
      const payload = generationClientMock.generate.mock.calls[0][0] as {
        patientNotes: Array<{ answerText: string }>;
      };
      expect(payload.patientNotes[0].answerText).toBe('[장소]에 다녀왔어요');
    });

    it('토큰화 → 마스킹 순서로 처리한다 (마스킹은 토큰화된 텍스트를 받는다)', async () => {
      personaSource = {
        hometown: null,
        occupation: null,
        hobbies: [],
        significantPlaces: [],
        family: [
          {
            relation: 'grandson',
            name: '민준',
            gender: 'M',
            relationOrdinal: 1,
          },
        ],
      };
      arrangeNotes('민준이랑 삼성병원에 갔어요');

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      // /mask가 받은 텍스트에는 이미 실명이 토큰으로 바뀌어 있어야 한다
      const maskedInput = fastApiClientMock.mask.mock.calls[0][0] as string;
      expect(maskedInput).toContain('[손자1]');
      expect(maskedInput).not.toContain('민준');
    });

    it('마스킹 실패 시 LLM을 호출하지 않고 생성을 실패 처리한다 (fail-closed)', async () => {
      arrangeNotes('서울 강남구에 다녀왔어요');
      fastApiClientMock.mask.mockRejectedValue(new Error('mask 503'));

      await expect(
        service.generateForMemoryEntry(MEMORY_ENTRY_ID),
      ).rejects.toThrow('mask 503');

      // 마스킹 안 된 원문이 외부 LLM으로 나가면 안 된다
      expect(generationClientMock.generate).not.toHaveBeenCalled();
      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationStatus: 'failed' }),
      );
    });
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

    it('빈칸(fill_blank)을 타일 조합·말하기로 변환해 영속화해야 한다 (타이핑 제거)', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending' }),
      );
      // LLM은 빈칸 2개를 반환 → 백엔드가 타일1 + 말하기1로 변환해야 함
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'fill_blank',
            prompt: '우리가 간 곳은 ___',
            choices: null,
            correctAnswer: '바다',
            hintFirstChar: '바',
          },
          {
            type: 'fill_blank',
            prompt: '무엇을 보았나요? ___',
            choices: null,
            correctAnswer: '강아지',
            hintFirstChar: '강',
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      const createCalls = quizQuestionRepo.create.mock.calls as unknown[][];
      const createdTypes = createCalls.map(
        (c) => (c[0] as { type: string }).type,
      );
      // 빈칸은 전부 말하기(따라읽기)로 변환된다.
      expect(createdTypes).toEqual(['speech', 'speech']);

      // 음절 타일은 여기서 만들지 않는다. 기억 회상과 음절 조합을 한 문항에
      // 겹치면 틀렸을 때 무엇을 못한 건지 분리되지 않고, 매일 다른 메모에서
      // 나오는 문항이라 같은 목표가 반복되지 않는다. 타일 과제는 커리큘럼
      // 단어 풀 기반의 독립 검사(subtest `spell`)로 옮겼다.
      expect(createdTypes).not.toContain('tile_arrange');

      // 말하기 문항은 따라읽기: choices 없음, 프롬프트는 안내 문구, 읽을 단어는 correctAnswer로 보존
      const speechArg = createCalls[1][0] as {
        choices: unknown;
        prompt: string;
        correctAnswer: string;
      };
      expect(speechArg.choices).toBeNull();
      expect(speechArg.correctAnswer).toBe('강아지');
      expect(speechArg.prompt).toContain('따라');
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
      // 이 테스트들의 관심사는 LLM에 나간 페이로드다. 다만 문항이 0개면
      // "0문항 → failed" 가드에 걸리므로 통과용 문항 1개를 돌려준다.
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 했나요?',
            choices: ['산책', '독서'],
            correctAnswer: '산책',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      const calls = generationClientMock.generate.mock.calls as unknown[][];
      const payload = calls[0][0] as Record<string, unknown>;
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
      // 이 테스트들의 관심사는 LLM에 나간 페이로드다. 다만 문항이 0개면
      // "0문항 → failed" 가드에 걸리므로 통과용 문항 1개를 돌려준다.
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 했나요?',
            choices: ['산책', '독서'],
            correctAnswer: '산책',
            hintFirstChar: null,
          },
        ],
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

    it('force=true 재생성 시 동일 memoryEntry의 기존 set을 삭제한 뒤 신규 pending set을 만들어야 한다 (P1)', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      // 기존 set 존재
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizSetRepo.delete.mockResolvedValue({ affected: 1 });
      quizSetRepo.save.mockResolvedValue(
        buildSet({ id: 'new-set', generationStatus: 'pending' }),
      );
      // 백그라운드 runGeneration 의존성
      // 이 테스트들의 관심사는 LLM에 나간 페이로드다. 다만 문항이 0개면
      // "0문항 → failed" 가드에 걸리므로 통과용 문항 1개를 돌려준다.
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 했나요?',
            choices: ['산책', '독서'],
            correctAnswer: '산책',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.requestGeneration(
        MEMORY_ENTRY_ID,
        CAREGIVER_ID,
        true,
      );

      // 기존 set을 memoryEntryId 기준으로 삭제 (cascade로 questions/attempts/best 정리)
      expect(quizSetRepo.delete).toHaveBeenCalledWith({
        memoryEntryId: MEMORY_ENTRY_ID,
      });
      // 신규 pending set 생성
      expect(quizSetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ generationStatus: 'pending' }),
      );
      expect(result.quizSetId).toBe('new-set');
      expect(result.generationStatus).toBe('pending');
    });

    it('기존 set이 failed 상태이면 force 없이도 재생성(삭제 후 신규)해야 한다 (P2)', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      // 기존 set이 실패 상태
      quizSetRepo.findOne.mockResolvedValue(
        buildSet({ generationStatus: 'failed' }),
      );
      quizSetRepo.delete.mockResolvedValue({ affected: 1 });
      quizSetRepo.save.mockResolvedValue(
        buildSet({ id: 'retry-set', generationStatus: 'pending' }),
      );
      // 이 테스트들의 관심사는 LLM에 나간 페이로드다. 다만 문항이 0개면
      // "0문항 → failed" 가드에 걸리므로 통과용 문항 1개를 돌려준다.
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 했나요?',
            choices: ['산책', '독서'],
            correctAnswer: '산책',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.requestGeneration(
        MEMORY_ENTRY_ID,
        CAREGIVER_ID,
        false, // force 미지정이어도 failed면 재생성
      );

      expect(quizSetRepo.delete).toHaveBeenCalledWith({
        memoryEntryId: MEMORY_ENTRY_ID,
      });
      expect(result.quizSetId).toBe('retry-set');
      expect(result.generationStatus).toBe('pending');
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

    /** 조건부 UPDATE 쿼리빌더 체이닝 mock — execute 결과(affected) 지정 */
    function buildUpdateQb(executeResult: { affected: number }) {
      const qb: Record<string, jest.Mock> = {
        update: jest.fn(),
        set: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        execute: jest.fn().mockResolvedValue(executeResult),
      };
      qb.update.mockReturnValue(qb);
      qb.set.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);
      return qb;
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
      // 신규 답안은 단일 save 호출로 일괄 저장 (배치 = 원자성)
      expect(quizAttemptRepo.save).toHaveBeenCalledTimes(1);
      const saveCalls = quizAttemptRepo.save.mock.calls as unknown[][];
      const savedArg = saveCalls[0][0] as unknown[];
      expect(savedArg).toHaveLength(2);
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
      // 기존 최고점 100 (findOne은 갱신 전/후 모두 100 반환)
      quizBestScoreRepo.findOne.mockResolvedValue({
        id: 'best-1',
        bestScore: 100,
      });
      // 조건부 UPDATE(best_score < 0)는 갱신 대상 없음 → affected 0
      quizBestScoreRepo.createQueryBuilder.mockReturnValue(
        buildUpdateQb({ affected: 0 }),
      );

      const result = await service.submitAttempts(
        QUIZ_SET_ID,
        PATIENT_ID,
        buildDto([{ questionId: 'q-0', userAnswer: 'x' }]),
      );

      expect(result.completed).toBe(true);
      expect(result.isNewBest).toBe(false);
      expect(result.bestScore).toBe(100);
      // 신규 INSERT(save)는 호출되지 않아야 한다 (기존 행 존재)
      expect(quizBestScoreRepo.save).not.toHaveBeenCalled();
    });

    it('동시 완료(INSERT UNIQUE 충돌 23505) 시 500 없이 조건부 UPDATE로 폴백해야 한다 (P2)', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue([buildQuestion({ id: 'q-0' })]);
      quizAttemptRepo.find.mockResolvedValue([]);
      scorerMock.isCorrect.mockReturnValue(true);
      scorerMock.toScore.mockReturnValue(100);
      quizAttemptRepo.save.mockImplementation((x: Record<string, unknown>) =>
        Promise.resolve({ ...x }),
      );
      // 1st findOne(없음) → INSERT 시도 → 동시 INSERT가 먼저 들어와 UNIQUE 위반
      // 2nd findOne(폴백 UPDATE 후) → 현재값 100
      quizBestScoreRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ bestScore: 100 });
      quizBestScoreRepo.save.mockRejectedValue({ code: '23505' });
      // 폴백 조건부 UPDATE가 우리 점수로 갱신 성공 → affected 1
      quizBestScoreRepo.createQueryBuilder.mockReturnValue(
        buildUpdateQb({ affected: 1 }),
      );

      const result = await service.submitAttempts(
        QUIZ_SET_ID,
        PATIENT_ID,
        buildDto([{ questionId: 'q-0', userAnswer: '공원' }]),
      );

      // 500(throw) 없이 정상 완료
      expect(result.completed).toBe(true);
      expect(result.isNewBest).toBe(true);
      expect(result.bestScore).toBe(100);
    });

    it('best-score INSERT가 UNIQUE 외 에러이면 그대로 전파해야 한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      quizQuestionRepo.find.mockResolvedValue([buildQuestion({ id: 'q-0' })]);
      quizAttemptRepo.find.mockResolvedValue([]);
      scorerMock.isCorrect.mockReturnValue(true);
      scorerMock.toScore.mockReturnValue(100);
      quizAttemptRepo.save.mockImplementation((x: Record<string, unknown>) =>
        Promise.resolve({ ...x }),
      );
      quizBestScoreRepo.findOne.mockResolvedValue(null);
      quizBestScoreRepo.save.mockRejectedValue({ code: '08006' }); // 연결 오류 등

      await expect(
        service.submitAttempts(
          QUIZ_SET_ID,
          PATIENT_ID,
          buildDto([{ questionId: 'q-0', userAnswer: '공원' }]),
        ),
      ).rejects.toMatchObject({ code: '08006' });
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
      const qb: Record<string, jest.Mock> = {
        where: jest.fn(),
        andWhere: jest.fn(),
        orderBy: jest.fn(),
        take: jest.fn(),
        getMany: jest.fn().mockResolvedValue(getManyResult),
      };
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);
      qb.orderBy.mockReturnValue(qb);
      qb.take.mockReturnValue(qb);
      return qb;
    }

    it('조회된 set이 없으면 빈 배열을 반환해야 한다', async () => {
      quizSetRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([]));

      const result = await service.listSets(PATIENT_ID, {});

      expect(result).toEqual([]);
    });

    it('set 목록을 요약 DTO(quizSetId/bestScore 등)로 매핑해야 한다', async () => {
      const set = buildSet();
      quizSetRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([set]));
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
      expect(result[0].generationStatus).toBe('ready');
      // 보호자 입력 원문(notePreview)은 더 이상 노출하지 않는다
      expect('notePreview' in result[0]).toBe(false);
    });

    it('limit을 최대 50으로 캡하고, 유효하지 않은 값(NaN)은 기본 20으로 보정해야 한다 (Nit)', async () => {
      const qbOverCap = buildQueryBuilder([]);
      quizSetRepo.createQueryBuilder.mockReturnValue(qbOverCap);
      await service.listSets(PATIENT_ID, { limit: 999 });
      expect(qbOverCap.take).toHaveBeenCalledWith(50);

      const qbNaN = buildQueryBuilder([]);
      quizSetRepo.createQueryBuilder.mockReturnValue(qbNaN);
      await service.listSets(PATIENT_ID, { limit: Number('abc') });
      expect(qbNaN.take).toHaveBeenCalledWith(20);
    });
  });

  // ─── 막힌 QuizSet 복구 (pending durability + failed 구제) ─────────
  describe('recoverStuckSets', () => {
    it('stale pending set이 없으면 아무 것도 하지 않고 0을 반환한다', async () => {
      quizSetRepo.find.mockResolvedValue([]);

      const result = await service.recoverStuckSets();

      expect(result).toEqual({ recovered: 0, failed: 0, skipped: 0 });
      expect(generationClientMock.generate).not.toHaveBeenCalled();
    });

    it('stale pending set을 재생성하여 ready로 복구한다', async () => {
      quizSetRepo.find.mockResolvedValue([
        buildSet({ generationStatus: 'pending' }),
      ]);
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
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

      const result = await service.recoverStuckSets();

      expect(result.recovered).toBe(1);
      expect(generationClientMock.generate).toHaveBeenCalledTimes(1);
      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationStatus: 'ready' }),
      );
    });

    it('원본 라이프로그가 삭제됐으면 생성하지 않고 failed로 마감한다', async () => {
      quizSetRepo.find.mockResolvedValue([
        buildSet({ generationStatus: 'pending' }),
      ]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 }); // claim 성공
      memoryEntryRepo.findOne.mockResolvedValue(null); // 삭제됨

      const result = await service.recoverStuckSets();

      expect(result.failed).toBe(1);
      expect(generationClientMock.generate).not.toHaveBeenCalled();
      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationStatus: 'failed' }),
      );
    });

    it('노트가 없으면 생성하지 않고 failed로 마감한다', async () => {
      quizSetRepo.find.mockResolvedValue([
        buildSet({ generationStatus: 'pending' }),
      ]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 }); // claim 성공
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([]); // 노트 없음

      const result = await service.recoverStuckSets();

      expect(result.failed).toBe(1);
      expect(generationClientMock.generate).not.toHaveBeenCalled();
      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationStatus: 'failed' }),
      );
    });

    it('되살릴 수 없는 set은 재시도 대상에서 영구 제외한다 (attempts를 상한으로)', async () => {
      quizSetRepo.find.mockResolvedValue([
        buildSet({ generationStatus: 'pending' }),
      ]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 }); // claim 성공
      memoryEntryRepo.findOne.mockResolvedValue(null); // 원본 삭제됨

      await service.recoverStuckSets();

      // 매 부팅마다 같은 set을 다시 집어들지 않도록 상한을 박아둔다
      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationAttempts: 3 }),
      );
    });

    it('다른 워커가 먼저 claim했으면(affected 0) 건너뛴다 (중복 생성 방지)', async () => {
      quizSetRepo.find.mockResolvedValue([
        buildSet({ generationStatus: 'pending' }),
      ]);
      quizSetRepo.update.mockResolvedValue({ affected: 0 }); // claim 실패
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);

      const result = await service.recoverStuckSets();

      expect(result.skipped).toBe(1);
      expect(result.recovered).toBe(0);
      // claim 실패면 엔트리 조회도, 생성도 하지 않는다
      expect(memoryEntryRepo.findOne).not.toHaveBeenCalled();
      expect(generationClientMock.generate).not.toHaveBeenCalled();
    });

    it('failed set(업스트림 일시 오류)도 재시도해 ready로 복구한다', async () => {
      quizSetRepo.find.mockResolvedValue([
        buildSet({ generationStatus: 'failed', generationAttempts: 1 }),
      ]);
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
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

      const result = await service.recoverStuckSets();

      expect(result.recovered).toBe(1);
      expect(quizSetRepo.update).toHaveBeenCalledWith(
        QUIZ_SET_ID,
        expect.objectContaining({ generationStatus: 'ready' }),
      );
    });

    it('시도 상한 미만인 set만 조회한다 (영구 실패 콘텐츠 무한 재시도 방지)', async () => {
      quizSetRepo.find.mockResolvedValue([]);

      await service.recoverStuckSets();

      // pending/failed 두 조건 모두 attempts < 3 으로 제한되어야 한다
      const where = quizSetRepo.find.mock.calls[0][0].where as Array<
        Record<string, unknown>
      >;
      expect(where).toHaveLength(2);
      for (const condition of where) {
        expect(condition.generationAttempts).toBeDefined();
      }
      expect(where.map((c) => c.generationStatus)).toEqual([
        'pending',
        'failed',
      ]);
    });

    it('생성 시도 시작 시점에 attempts를 증가시킨다 (도중 crash에도 카운트 유지)', async () => {
      memoryEntryRepo.findOne.mockResolvedValue(buildEntry());
      patientMemoryNoteRepo.find.mockResolvedValue([buildNote()]);
      quizSetRepo.findOne.mockResolvedValue(null);
      quizSetRepo.save.mockResolvedValue(
        buildSet({ generationStatus: 'pending', generationAttempts: 1 }),
      );
      // 이 테스트들의 관심사는 LLM에 나간 페이로드다. 다만 문항이 0개면
      // "0문항 → failed" 가드에 걸리므로 통과용 문항 1개를 돌려준다.
      generationClientMock.generate.mockResolvedValue({
        questions: [
          {
            type: 'multiple_choice',
            prompt: '무엇을 했나요?',
            choices: ['산책', '독서'],
            correctAnswer: '산책',
            hintFirstChar: null,
          },
        ],
        model: 'm',
        fallbackUsed: false,
      });
      quizQuestionRepo.save.mockResolvedValue([]);
      quizSetRepo.update.mockResolvedValue({ affected: 1 });

      await service.generateForMemoryEntry(MEMORY_ENTRY_ID);

      // LLM 호출 전에 attempts를 원자적으로 increment한다(read-modify-write 아님)
      expect(quizSetRepo.increment).toHaveBeenCalledWith(
        { id: QUIZ_SET_ID },
        'generationAttempts',
        1,
      );
    });
  });

  // ─── 한마디→발화연습 (Phase 6 Pattern 1) ─────────────────────────────
  describe('getWishPractice', () => {
    const WISH_RESULT = {
      echoSentence: '사랑해 우리 손녀',
      fillBlank: {
        prompt: '사랑해 우리 ___',
        answer: '손녀',
        hintFirstChar: '손',
      },
      model: 'gemini-2.5-flash-lite',
      fallbackUsed: false,
    };

    it('한마디가 있으면 wishClient.convert 결과를 반환한다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      memoryEntryRepo.findOne.mockResolvedValue(
        buildEntry({ caregiverWishMessage: '사랑해 우리 손녀' }),
      );
      wishClientMock.convert.mockResolvedValue(WISH_RESULT);

      const result = await service.getWishPractice(QUIZ_SET_ID, PATIENT_ID);

      expect(wishClientMock.convert).toHaveBeenCalledWith('사랑해 우리 손녀');
      expect(result).toEqual(WISH_RESULT);
    });

    it('한마디가 없으면 NO_WISH_MESSAGE를 던진다', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());
      memoryEntryRepo.findOne.mockResolvedValue(
        buildEntry({ caregiverWishMessage: null }),
      );

      await expect(
        service.getWishPractice(QUIZ_SET_ID, PATIENT_ID),
      ).rejects.toMatchObject({ code: QuizErrorCode.NO_WISH_MESSAGE });
      expect(wishClientMock.convert).not.toHaveBeenCalled();
    });

    it('다른 환자면 FORBIDDEN (소유권 검증)', async () => {
      quizSetRepo.findOne.mockResolvedValue(buildSet());

      await expect(
        service.getWishPractice(QUIZ_SET_ID, 'other-patient'),
      ).rejects.toMatchObject({ code: QuizErrorCode.FORBIDDEN });
      expect(wishClientMock.convert).not.toHaveBeenCalled();
    });
  });

  // ─── QAB 결과 저장/요약 ─────────────────────────────────────────────
  describe('saveQabResults', () => {
    it('유효 환자 ID로 결과를 일괄 저장하고 저장 개수를 반환한다', async () => {
      skillLevelRepo.find.mockResolvedValue([]);
      qabResultRepo.save.mockResolvedValue([]);
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [
          { subtest: 'word', itemRef: 'qw_001', isCorrect: true },
          { subtest: 'ddk', itemRef: 'ddk_0', isCorrect: true, metric: 11 },
        ],
      };

      const res = await service.saveQabResults(PATIENT_ID, dto);

      expect(res).toEqual({ saved: 2 });
      expect(qabResultRepo.save).toHaveBeenCalledTimes(1);
      // 클라 입력이 아닌 유효 환자 ID로 저장되어야 한다
      const savedRows = qabResultRepo.create.mock.calls.map((c) => c[0]);
      expect(savedRows[0]).toMatchObject({
        patientId: PATIENT_ID,
        sessionToken: SESSION_TOKEN,
        subtest: 'word',
        isCorrect: true,
        assisted: false,
        metric: null,
      });
      expect(savedRows[1]).toMatchObject({ subtest: 'ddk', metric: 11 });
    });

    it('재제출 멱등을 ON CONFLICT DO NOTHING으로 얻는다 — 예외를 내지 않는다', async () => {
      // 예전에는 UNIQUE 위반을 try/catch로 삼켰는데, PostgreSQL에서 그건 멱등이
      // 아니다. 트랜잭션 안에서 에러가 나는 순간 abort 상태가 되어, 바로 뒤의
      // 레벨 재계산·완료 마커가 25P02로 같이 죽는다. 즉 **애초에 예외가 나지
      // 않아야** 하고, 그걸 보장하는 게 orIgnore()다.
      skillLevelRepo.find.mockResolvedValue([]);
      qabResultRepo.save.mockResolvedValue([]);
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [{ subtest: 'word', itemRef: 'qw_001', isCorrect: true }],
      };

      await expect(service.saveQabResults(PATIENT_ID, dto)).resolves.toEqual({
        saved: 1,
      });
      expect(orIgnoreCalls).toHaveLength(1);
    });

    it('중복 제출이어도 레벨 재계산과 완료 마커가 진행된다', async () => {
      // 이게 무너졌던 지점이다. insert가 조용히 no-op이 되므로 트랜잭션은
      // 살아 있고, 뒤따르는 작업이 정상 수행돼야 한다.
      skillLevelRepo.find.mockResolvedValue([]);
      qabResultRepo.save.mockResolvedValue([]);
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        completed: true,
        results: [{ subtest: 'word', itemRef: 'qw_001', isCorrect: true }],
      };

      await service.saveQabResults(PATIENT_ID, dto);

      expect(qabSessionCompletionRepo.upsert).toHaveBeenCalledTimes(1);
    });

    it('보낼 결과가 없어도 완료 마커는 남긴다', async () => {
      // 프론트는 문항마다 점진 제출하므로 세션이 끝나는 시점엔 tail이 비어
      // 있는 경우가 흔하다(특히 피로 탈출). 예전엔 DTO가 빈 배열을 400으로
      // 막고 프론트도 조기 반환해, **설계상 정상 종료가 중도 이탈로 기록됐다.**
      // 보호자 대시보드의 완료율이 그만큼 낮게 나온다.
      skillLevelRepo.find.mockResolvedValue([]);
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        completed: true,
        results: [],
      };

      const res = await service.saveQabResults(PATIENT_ID, dto);

      expect(res).toEqual({ saved: 0 });
      expect(qabSessionCompletionRepo.upsert).toHaveBeenCalledTimes(1);
      // 넣을 행이 없으면 insert 자체를 건너뛴다(빈 values는 TypeORM이 거부한다).
      expect(orIgnoreCalls).toHaveLength(0);
    });

    it('DB 오류는 그대로 전파한다', async () => {
      skillLevelRepo.find.mockResolvedValue([]);
      qabResultRepo.save.mockRejectedValue({ code: '08006' }); // connection failure
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [{ subtest: 'word', itemRef: 'qw_001', isCorrect: true }],
      };

      await expect(
        service.saveQabResults(PATIENT_ID, dto),
      ).rejects.toMatchObject({ code: '08006' });
    });

    it('presentedLevel은 클라이언트 값을 무시하고 서버의 현재 레벨로 확정한다', async () => {
      // word는 서버 상태에 레벨 4가 있고, naming은 행이 없어 콜드스타트(2)로 채워진다.
      skillLevelRepo.find.mockResolvedValue([{ subtest: 'word', level: 4 }]);
      qabResultRepo.save.mockResolvedValue([]);
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [
          // 클라이언트가 보낸 3은 무시되고, 서버의 현재 레벨 4가 저장돼야 한다.
          {
            subtest: 'word',
            itemRef: 'qw_001',
            isCorrect: true,
            presentedLevel: 3,
          },
          { subtest: 'naming', itemRef: 'nm_001', isCorrect: false },
        ],
        manifestVersion: 1,
      };

      await service.saveQabResults(PATIENT_ID, dto);

      const savedRows = qabResultRepo.create.mock.calls.map((c) => c[0]);
      expect(savedRows[0]).toMatchObject({
        subtest: 'word',
        presentedLevel: 4,
      });
      // 레벨 이력 없는 서브테스트는 콜드스타트(2)로 확정된다(null이 아니다).
      expect(savedRows[1]).toMatchObject({
        subtest: 'naming',
        presentedLevel: 2,
      });
    });

    it('오답 갈래는 틀린 문항에만 저장한다', async () => {
      // 맞힌 행에 갈래가 붙으면 "오답이 아닌데 오답 갈래가 있는 행"이 생겨
      // 갈래별 집계가 조용히 틀린다. 프론트가 안 보내는 것이 정상이지만
      // 서버에서도 떨군다 — 관측값이라 서버가 되짚을 수 없기 때문이다.
      skillLevelRepo.find.mockResolvedValue([]);
      qabResultRepo.save.mockResolvedValue([]);
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [
          {
            subtest: 'word',
            itemRef: 'qw_001',
            isCorrect: false,
            foilKind: 'phonological',
          },
          // 맞혔는데 갈래가 온 경우 — 떨궈야 한다.
          {
            subtest: 'word',
            itemRef: 'qw_002',
            isCorrect: true,
            foilKind: 'semantic',
          },
          // 안 보낸 경우 — null.
          { subtest: 'word', itemRef: 'qw_003', isCorrect: false },
        ],
      };

      await service.saveQabResults(PATIENT_ID, dto);

      const savedRows = qabResultRepo.create.mock.calls.map((c) => c[0]);
      expect(savedRows[0]).toMatchObject({ foilKind: 'phonological' });
      expect(savedRows[1]).toMatchObject({ foilKind: null });
      expect(savedRows[2]).toMatchObject({ foilKind: null });
    });

    it('오답 갈래는 레벨 재계산에 끼어들지 않는다', async () => {
      // 관측 전용이다. 클라이언트가 보내는 값이 측정에 물리면 조작으로 레벨이
      // 움직인다 — presented_level을 서버가 확정하는 것과 같은 이유다.
      skillLevelRepo.find.mockResolvedValue([{ subtest: 'word', level: 3 }]);
      qabResultRepo.save.mockResolvedValue([]);
      const base = {
        subtest: 'word' as const,
        itemRef: 'qw_001',
        isCorrect: false,
      };

      await service.saveQabResults(PATIENT_ID, {
        sessionToken: SESSION_TOKEN,
        results: [{ ...base, foilKind: 'semantic' as const }],
      });
      const withKind = skillLevelRepo.upsert.mock.calls.length;
      skillLevelRepo.upsert.mockClear();

      await service.saveQabResults(PATIENT_ID, {
        sessionToken: SESSION_TOKEN,
        results: [base],
      });

      expect(skillLevelRepo.upsert.mock.calls.length).toBe(withKind);
    });

    it('completed=true면 완료 마커를 남긴다(완료 vs 중단 구분)', async () => {
      skillLevelRepo.find.mockResolvedValue([]);
      qabResultRepo.save.mockResolvedValue([]);
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [{ subtest: 'word', itemRef: 'qw_001', isCorrect: true }],
        completed: true,
      };

      await service.saveQabResults(PATIENT_ID, dto);

      expect(qabSessionCompletionRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionToken: SESSION_TOKEN,
          patientId: PATIENT_ID,
        }),
        ['sessionToken'],
      );
    });

    it('completed 생략(점진 제출의 중간 flush)이면 완료 마커를 남기지 않는다', async () => {
      skillLevelRepo.find.mockResolvedValue([]);
      qabResultRepo.save.mockResolvedValue([]);
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [{ subtest: 'word', itemRef: 'qw_001', isCorrect: true }],
      };

      await service.saveQabResults(PATIENT_ID, dto);

      expect(qabSessionCompletionRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getSkillLevels', () => {
    it('이력이 없으면 전 스킬을 콜드스타트 레벨 2로 채운다', async () => {
      skillLevelRepo.find.mockResolvedValue([]);

      const res = await service.getSkillLevels(PATIENT_ID);

      // 버전을 올릴 때마다 테스트가 깨지지 않도록 상수를 참조한다.
      expect(res.manifestVersion).toBe(QAB_MANIFEST_VERSION);
      for (const subtest of QAB_SUBTESTS) {
        expect(res.levels[subtest]).toBe(2);
      }
    });

    it('저장된 레벨은 반영하고 나머지는 콜드스타트로 채운다', async () => {
      skillLevelRepo.find.mockResolvedValue([
        { subtest: 'word', level: 4 },
        { subtest: 'ddk', level: 1 },
      ]);

      const res = await service.getSkillLevels(PATIENT_ID);

      expect(res.levels.word).toBe(4);
      expect(res.levels.ddk).toBe(1);
      expect(res.levels.naming).toBe(2); // 이력 없음 → 콜드스타트
    });
  });

  describe('getActivityDays', () => {
    it('완료 날짜 배열(YYYY-MM-DD)을 반환한다', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ day: '2026-08-12' }, { day: '2026-08-10' }]),
      };
      qabResultRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.getActivityDays(PATIENT_ID, 14);

      expect(res).toEqual(['2026-08-12', '2026-08-10']);
      expect(qb.where).toHaveBeenCalledWith('r.patient_id = :pid', {
        pid: PATIENT_ID,
      });
    });
  });

  describe('getRecentItems', () => {
    /** createQueryBuilder 체이닝 mock — getRawMany 결과를 지정 */
    function arrangeRecent(rows: unknown[]) {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      qabResultRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    it('문항별 최근 성적을 ISO 문자열로 반환한다', async () => {
      arrangeRecent([
        {
          itemRef: 'spell_w9',
          lastCorrect: false,
          lastAt: new Date('2026-08-16T00:00:00.000Z'),
        },
      ]);

      const res = await service.getRecentItems(PATIENT_ID, 'spell', 30);

      expect(res).toEqual([
        {
          itemRef: 'spell_w9',
          lastCorrect: false,
          lastAt: '2026-08-16T00:00:00.000Z',
        },
      ]);
    });

    it('보호자가 넘어가기로 통과시킨 결과는 제외한다', async () => {
      // assisted는 실력 근거가 아니다. 재출제 우선순위를 왜곡하면 안 된다.
      const qb = arrangeRecent([]);

      await service.getRecentItems(PATIENT_ID, 'spell');

      expect(qb.andWhere).toHaveBeenCalledWith('r.assisted = false');
    });

    it('요청 검사만 조회한다', async () => {
      const qb = arrangeRecent([]);

      await service.getRecentItems(PATIENT_ID, 'spell');

      expect(qb.andWhere).toHaveBeenCalledWith('r.subtest = :subtest', {
        subtest: 'spell',
      });
    });

    it('limit을 안전 범위로 가둔다', async () => {
      // 사용자 입력이 그대로 오면 전체 이력을 훑게 된다.
      const qb = arrangeRecent([]);

      await service.getRecentItems(PATIENT_ID, 'spell', 30, 99999);

      expect(qb.limit).toHaveBeenCalledWith(200);
    });

    it('틀린 문항 먼저, 그 안에서 오래된 것 먼저 정렬한다', async () => {
      // **이 순서가 곧 간격 반복이다.** 프론트는 응답 순서를 그대로 우선순위로
      // 쓰므로(useMixedQuizSession), 여기서 ASC/DESC가 뒤집히면 맞힌 문항부터,
      // 방금 낸 문항부터 다시 나온다 — 반복 훈련이 정반대로 동작한다.
      // 변환·필터만 검증하던 때는 이 뒤집힘이 전부 통과했다.
      const qb = arrangeRecent([]);

      await service.getRecentItems(PATIENT_ID, 'spell');

      // 1순위: 최근에 틀린 문항(false < true)
      expect(qb.orderBy).toHaveBeenCalledWith('"lastCorrect"', 'ASC');
      // 2순위: 마지막 출제가 오래된 것 — 여기서 "간격"이 생긴다
      expect(qb.addOrderBy).toHaveBeenCalledWith('max(r.created_at)', 'ASC');
    });

    it('정오답을 최신 시도로 판정한다 — bool_or를 쓰지 않는다', async () => {
      // bool_or(= 한 번이라도 맞았나)를 쓰면 3주 전에 한 번 맞히고 **어제 틀린**
      // 문항이 "맞힌 것" 그룹으로 가고, 그 안에서도 최근이라 맨 뒤로 밀린다.
      // 방금 틀린 낱말이 우선순위 꼴찌가 되어 반복 훈련이 거꾸로 동작한다.
      //
      // 앞의 정렬 테스트는 이걸 못 잡는다 — 정렬 방향만 보고 무엇을 정렬하는지는
      // 묻지 않기 때문이다. 그래서 판정식 자체를 따로 고정한다.
      const qb = arrangeRecent([]);

      await service.getRecentItems(PATIENT_ID, 'spell');

      const selected = qb.addSelect.mock.calls.map((c) => String(c[0]));
      expect(selected).toContainEqual(
        expect.stringContaining(
          'array_agg(r.is_correct ORDER BY r.created_at DESC',
        ),
      );
      expect(selected.join(' ')).not.toContain('bool_or');
    });
  });

  describe('getSessionStats', () => {
    /**
     * getSessionStats가 쓰는 **세 리포지토리**의 쿼리빌더를 각각 목킹한다.
     *
     * 하나로 뭉치면 "분모가 QAB만 센다"는 회귀를 못 잡는다 — 데일리 전용 세션이
     * 어느 쿼리에서 오는지가 이 수정의 요점이라, 리포지토리별로 다른 행을 준다.
     *
     * @param qab         QAB 결과가 남은 세션: 토큰 + 그 세션의 QAB 문항 수
     * @param attempts    데일리 문항을 푼 세션 토큰
     * @param completions 완료 마커가 찍힌 세션 토큰
     */
    function arrangeStats(
      qab: Array<{ token: string; items: string }>,
      attempts: Array<{ token: string }> = [],
      completions: Array<{ token: string }> = [],
    ) {
      const buildQb = (rows: unknown[]) => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      });
      qabResultRepo.createQueryBuilder.mockReturnValue(buildQb(qab));
      quizAttemptRepo.createQueryBuilder.mockReturnValue(buildQb(attempts));
      qabSessionCompletionRepo.createQueryBuilder.mockReturnValue(
        buildQb(completions),
      );
    }

    /** s1..sN 형태의 QAB 세션 행 — items는 postgres가 주는 대로 문자열이다 */
    function qabSessions(
      items: number[],
    ): Array<{ token: string; items: string }> {
      return items.map((n, i) => ({ token: `s${i + 1}`, items: String(n) }));
    }

    it('시작·완료 세션 수와 완료율(0..100)을 반환한다', async () => {
      // 10세션 시작, 그중 7세션에 완료 마커. 남은 3세션이 이탈이다.
      arrangeStats(
        qabSessions([9, 2, 1, 5, 5, 5, 5, 5, 5, 5]),
        [],
        ['s4', 's5', 's6', 's7', 's8', 's9', 's10'].map((token) => ({ token })),
      );

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res).toEqual({
        started: 10,
        completed: 7,
        completionRate: 70,
        avgItemsBeforeDropoff: 4, // (9+2+1)/3
      });
    });

    it('QAB 문항 없이 데일리만 푼 세션도 분모에 잡힌다', async () => {
      // 이게 TODO-101 분모 버그였다. QAB 슬롯이 0인 세션 구성이 존재하는데
      // qab_results만 세면 그 세션은 "시작한 적도 없는" 것으로 사라졌다.
      arrangeStats([], [{ token: 'daily-only' }], []);

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res).toMatchObject({
        started: 1,
        completed: 0,
        completionRate: 0,
      });
    });

    it('데일리만 푼 세션도 완료 마커가 있으면 분자에 잡힌다', async () => {
      arrangeStats([], [{ token: 'daily-only' }], [{ token: 'daily-only' }]);

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res).toMatchObject({
        started: 1,
        completed: 1,
        completionRate: 100,
      });
    });

    it('한 세션이 QAB·데일리 양쪽에 있어도 한 번만 센다', async () => {
      // 실제로 흔한 구성(섞어 진행)이다. 합집합이 아니라 합이면 완료율이 반토막 난다.
      arrangeStats(
        [{ token: 's1', items: '3' }],
        [{ token: 's1' }],
        [{ token: 's1' }],
      );

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res).toMatchObject({
        started: 1,
        completed: 1,
        completionRate: 100,
      });
    });

    it('창 밖 세션의 완료 마커가 완료율을 100% 위로 밀지 못한다', async () => {
      // 마커 쪽 시간 창과 결과 쪽 시간 창이 어긋날 수 있다. 교집합을 안 내면
      // completed가 started보다 커져서 "완료율 200%"가 나온다.
      arrangeStats(
        [{ token: 's1', items: '3' }],
        [],
        [{ token: 's1' }, { token: 'gone' }],
      );

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res).toMatchObject({
        started: 1,
        completed: 1,
        completionRate: 100,
      });
    });

    it('이탈 지점 평균은 QAB 문항이 있던 세션만 센다', async () => {
      // 데일리 전용 이탈 세션은 QAB 문항 수가 0이다. 섞어 세면 "0문항 풀고 이탈"이
      // 평균을 끌어내려, 지표가 "얼마나 하다 그만뒀나"를 뜻하지 않게 된다.
      arrangeStats(
        [{ token: 's1', items: '4' }],
        [{ token: 'daily-only' }],
        [],
      );

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res).toMatchObject({ started: 2, avgItemsBeforeDropoff: 4 });
    });

    it('이탈 세션이 없으면 이탈 지점은 null이다', async () => {
      arrangeStats(
        qabSessions([3, 3, 3, 3, 3]),
        [],
        ['s1', 's2', 's3', 's4', 's5'].map((token) => ({ token })),
      );

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res).toMatchObject({
        completionRate: 100,
        avgItemsBeforeDropoff: null,
      });
    });

    it('이탈 지점 평균은 소수 1자리로 반올림한다', async () => {
      // (1+2)/2 = 1.5 — 정수로 뭉개면 "1문항"과 "2문항"이 구분되지 않는다.
      arrangeStats(qabSessions([1, 2]), [], []);

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res.avgItemsBeforeDropoff).toBe(1.5);
    });

    it('시작한 세션이 없으면 완료율은 null이다(비율을 지어내지 않는다)', async () => {
      arrangeStats([], [], []);

      const res = await service.getSessionStats(PATIENT_ID, 30);

      expect(res).toEqual({
        started: 0,
        completed: 0,
        completionRate: null,
        avgItemsBeforeDropoff: null,
      });
    });
  });

  describe('getQabSummary', () => {
    it('오답 갈래를 세어 함께 내려보낸다', async () => {
      // 정답률은 몇 개 틀렸는지까지만 말한다. 무엇이 어려운지는 어떤 오답을
      // 골랐는가가 말한다.
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            subtest: 'word',
            total: '20',
            correct: '12',
            assisted: '0',
            avgMetric: null,
            maxMetric: null,
            avgScore: null,
            lastAt: new Date('2026-08-23T00:00:00.000Z'),
            foilSemantic: '5',
            foilPhonological: '3',
            foilUnrelated: '0',
          },
          {
            // 갈래가 하나도 없는 하위검사는 null이어야 한다.
            subtest: 'naming',
            total: '3',
            correct: '3',
            assisted: '0',
            avgMetric: null,
            maxMetric: null,
            avgScore: null,
            lastAt: new Date('2026-08-23T00:00:00.000Z'),
            foilSemantic: '0',
            foilPhonological: '0',
            foilUnrelated: '0',
          },
        ]),
      };
      qabResultRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.getQabSummary(PATIENT_ID);

      expect(res.items[0].foilKinds).toEqual({
        semantic: 5,
        phonological: 3,
        unrelated: 0,
      });
      expect(res.items[1].foilKinds).toBeNull();
    });

    it('검사별 정확도/지표를 집계해 반환한다', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            subtest: 'word',
            total: '4',
            correct: '3',
            assisted: '1',
            avgMetric: null,
            maxMetric: null,
            avgScore: '82.4',
            lastAt: new Date('2026-06-20T00:00:00.000Z'),
          },
          {
            subtest: 'ddk',
            total: '2',
            correct: '1',
            assisted: '0',
            avgMetric: '9.5',
            maxMetric: '11',
            avgScore: null,
            lastAt: new Date('2026-06-21T00:00:00.000Z'),
          },
        ]),
      };
      qabResultRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.getQabSummary(PATIENT_ID);

      expect(qb.where).toHaveBeenCalledWith('r.patient_id = :pid', {
        pid: PATIENT_ID,
      });
      expect(res.items).toEqual([
        {
          subtest: 'word',
          total: 4,
          correct: 3,
          accuracy: 75,
          assisted: 1,
          avgMetric: null,
          maxMetric: null,
          avgScore: 82,
          lastAt: '2026-06-20T00:00:00.000Z',
          // 갈래 집계 컬럼이 없는 행은 null이다. 0으로 채우면 "관계없는 그림
          // 0개" 같은 없는 사실이 화면에 그려진다.
          foilKinds: null,
        },
        {
          subtest: 'ddk',
          total: 2,
          correct: 1,
          accuracy: 50,
          assisted: 0,
          avgMetric: 9.5,
          maxMetric: 11,
          avgScore: null,
          lastAt: '2026-06-21T00:00:00.000Z',
          foilKinds: null,
        },
      ]);
    });

    it('데이터가 없으면 빈 배열', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      qabResultRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.getQabSummary(PATIENT_ID);
      expect(res.items).toEqual([]);
    });
  });

  describe('getQabTrend', () => {
    function trendQb(rows: unknown[]) {
      return {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
    }

    it('ddk 주차에 평균 감지 횟수(avgMetric)를 소수 1자리로 담는다', async () => {
      // 회귀: ddk의 핵심 지표는 감지 횟수다. 추이 쿼리가 이걸 빠뜨리면
      // 리포트가 정답률만 보여주고 말 움직임의 빠르기를 못 본다.
      const qb = trendQb([
        {
          weekStart: '2026-07-13',
          subtest: 'ddk',
          total: '4',
          correct: '3',
          avgScore: null,
          avgMetric: '18.46',
        },
      ]);
      qabResultRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.getQabTrend(PATIENT_ID, 12);

      const ddk = res.series.find((s) => s.subtest === 'ddk');
      expect(ddk?.points[0]).toEqual({
        weekStart: '2026-07-13',
        total: 4,
        correct: 3,
        accuracy: 75,
        avgScore: null,
        avgMetric: 18.5,
      });
    });

    it('metric이 없는 검사는 avgMetric이 null이다', async () => {
      const qb = trendQb([
        {
          weekStart: '2026-07-13',
          subtest: 'word',
          total: '10',
          correct: '7',
          avgScore: null,
          avgMetric: null,
        },
      ]);
      qabResultRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.getQabTrend(PATIENT_ID, 12);

      expect(res.series[0].points[0].avgMetric).toBeNull();
      expect(res.series[0].points[0].accuracy).toBe(70);
    });
  });
});
