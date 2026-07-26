import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitQabResultsDto } from './dto/submit-qab-results.dto';
import { QabResult } from './entities/qab-result.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { QuizError, QuizErrorCode } from './errors/quiz.errors';
import { QUIZ_GENERATION_CLIENT } from './interfaces/IQuizGenerationClient';
import { QUIZ_SCORER } from './interfaces/IQuizScorer';
import { WISH_CONVERSION_CLIENT } from './interfaces/IWishConversionClient';
import { FastApiClientService } from '../memory/services/fast-api-client.service';
import { PersonaContextService } from '../profile/services/persona-context.service';
import type {
  PersonaSource,
  ProfileService,
} from '../profile/profile.service';
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

    // 기본값: 프로필 미등록 → 개인화 생략(원문 그대로 통과)
    personaSource = null;
    personaContextMock = new PersonaContextService({
      getPersonaSource: jest.fn(async () => personaSource),
    } as unknown as ProfileService);

    fastApiClientMock = {
      mask: jest.fn(async (text: string) => ({ maskedText: text })),
    };

    quizSetRepo = buildRepoMock();
    quizQuestionRepo = buildRepoMock();
    quizAttemptRepo = buildRepoMock();
    quizBestScoreRepo = buildRepoMock();
    qabResultRepo = buildRepoMock();
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
              <T>(
                cb: (m: { getRepository: (e: unknown) => unknown }) => T,
              ): T =>
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
      // 첫 빈칸 → tile_arrange, 둘째 빈칸 → speech (번갈아 변환)
      expect(createdTypes).toEqual(['tile_arrange', 'speech']);

      // 타일 문항은 정답 음절을 choices에 담아야 한다 (정답은 별도 컬럼에 은닉)
      const tileArg = createCalls[0][0] as {
        choices: string[];
        correctAnswer: string;
      };
      expect(tileArg.correctAnswer).toBe('바다');
      expect(tileArg.choices).toEqual(expect.arrayContaining(['바', '다']));

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
      fillBlank: { prompt: '사랑해 우리 ___', answer: '손녀', hintFirstChar: '손' },
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

    it('같은 세션 재제출(UNIQUE 위반)은 멱등 — 던지지 않고 성공 처리', async () => {
      qabResultRepo.save.mockRejectedValue({ code: '23505' });
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [{ subtest: 'word', itemRef: 'qw_001', isCorrect: true }],
      };

      await expect(service.saveQabResults(PATIENT_ID, dto)).resolves.toEqual({
        saved: 1,
      });
    });

    it('UNIQUE 위반이 아닌 DB 오류는 전파한다', async () => {
      qabResultRepo.save.mockRejectedValue({ code: '08006' }); // connection failure
      const dto: SubmitQabResultsDto = {
        sessionToken: SESSION_TOKEN,
        results: [{ subtest: 'word', itemRef: 'qw_001', isCorrect: true }],
      };

      await expect(
        service.saveQabResults(PATIENT_ID, dto),
      ).rejects.toMatchObject({ code: '08006' });
    });
  });

  describe('getQabSummary', () => {
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
