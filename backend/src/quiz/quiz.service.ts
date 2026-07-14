import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { FastApiClientService } from '../memory/services/fast-api-client.service';
import { PersonaContextService } from '../profile/services/persona-context.service';
import { DEFAULT_QUIZ_DISTRIBUTION } from './constants/quiz-distribution';
import { QuizSetSummaryDto } from './dto/quiz-set-summary.dto';
import {
  QuizQuestionPublicDto,
  toQuizQuestionPublicDto,
} from './dto/quiz-question-public.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitQabResultsDto } from './dto/submit-qab-results.dto';
import { QabResult } from './entities/qab-result.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { QuizError, QuizErrorCode } from './errors/quiz.errors';
import {
  GeneratedQuizQuestion,
  IQuizGenerationClient,
  QUIZ_GENERATION_CLIENT,
} from './interfaces/IQuizGenerationClient';
import { buildTiles } from './services/tile-builder';
import type { IQuizGenerationPayload } from './interfaces/IQuizGenerationPayload';
import { IQuizScorer, QUIZ_SCORER } from './interfaces/IQuizScorer';
import {
  IWishConversionClient,
  WISH_CONVERSION_CLIENT,
  WishConversionResult,
} from './interfaces/IWishConversionClient';

/** 세션 만료 기준: 첫 답안 이후 30분 (§7-1 SESSION_EXPIRED) */
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * pending QuizSet이 이 시간보다 오래 멈춰 있으면 "고아"로 간주하고 복구한다.
 * LLM 타임아웃(25s)보다 충분히 길게 잡아 정상 진행 중인 생성을 건드리지 않는다.
 */
const STALE_PENDING_MS = 10 * 60 * 1000;

/** 1회 복구에서 처리할 최대 QuizSet 수 (부팅 스톰 방지) */
const MAX_RECOVERY_BATCH = 50;

/**
 * 생성 시도 상한. 부팅 복구가 failed set을 재시도하되, 노트 부족(422)처럼
 * 영원히 실패할 콘텐츠가 매 부팅마다 LLM을 때리는 것을 막는다.
 * 상한을 넘긴 set은 수동 재생성(force)으로만 되살릴 수 있다.
 */
const MAX_GENERATION_ATTEMPTS = 3;

/** 목록 조회 기본/최대 limit */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

/** 따라읽기(speech) 문항 고정 안내 문구 — 회상이 아니라 단어를 보고/듣고 따라 말한다. */
const SPEECH_REPEAT_PROMPT = '다음 단어를 듣고 따라 말해보세요';

/**
 * 환자에게 절대 보여선 안 되는 기계 잔재를 탐지한다.
 *
 * 두 종류가 섞여 들어온다:
 * 1. 훼손된 페르소나 토큰 — 대괄호 잔재("[___1]"). LLM이 토큰을 쪼갠 흔적.
 * 2. /mask가 만든 익명화 라벨 — "Family_M1", "Place_1", "PHONE_1" 등.
 *    프로필에 등록되지 않은 이름·장소는 마스킹되어 이 라벨로 바뀌고, 퀴즈 LLM은
 *    그 라벨을 그대로 문제에 쓴다("Family_F1과 어디에 갔나요?"). 대괄호가 없어
 *    토큰 잔재 검사에 걸리지 않는다.
 *
 * 정상 문항에 이런 문자열이 쓰일 일은 없다.
 */
const RESIDUAL_ARTIFACT_PATTERN =
  /\[[^\]\n]{0,30}\]|(?:Family|Place|PHONE|SSN|EMAIL)_[A-Z]?\d+/;

/**
 * /mask 동시 호출 상한. 노트(최대 5개)를 전부 병렬로 쏘면 곧바로 이어지는
 * /quiz/generate와 겹쳐 Gemini 레이트리밋을 유발한다(E2E에서 502 관측).
 */
const MASK_CONCURRENCY = 2;

/** 단일 답안 채점 결과 */
export interface AttemptResult {
  questionId: string;
  isCorrect: boolean;
  correctAnswer: string;
}

/** submitAttempts 반환 타입 */
export interface SubmitAttemptsResult {
  results: AttemptResult[];
  sessionScore: number;
  completed: boolean;
  bestScore?: number;
  isNewBest?: boolean;
}

/** getSetDetail 반환 타입 */
export interface QuizSetDetail {
  quizSetId: string;
  memoryEntry: {
    photoUrl: string | null;
    // Phase 6: 보호자 한마디 노출 (없으면 null). CaregiverWishCard 렌더 게이트.
    caregiverWishMessage: string | null;
  };
  patientNotes: Array<{ category: string; answerText: string }>;
  questions: QuizQuestionPublicDto[];
}

/** getBestScore 반환 타입 */
export interface BestScoreResult {
  quizSetId: string;
  bestScore: number | null;
  achievedAt?: string;
}

/** requestGeneration 반환 타입 */
export interface RequestGenerationResult {
  quizSetId: string;
  generationStatus: 'pending';
}

/** saveQabResults 반환 타입 */
export interface SaveQabResultsResult {
  saved: number;
}

/** QAB 검사별 회복 추적 요약 (보호자용) */
export interface QabSubtestSummary {
  subtest: string;
  /** 보호자 도움(넘어가기) 제외한 실제 응답 수 */
  total: number;
  correct: number;
  /** 0..100 정확도 (도움 제외 기준) */
  accuracy: number;
  /** 보호자가 넘어가기로 통과시킨 문항 수 */
  assisted: number;
  /** 수치 지표 평균(ddk 등). 없으면 null */
  avgMetric: number | null;
  /** 수치 지표 최고값(ddk 최고 횟수 등). 없으면 null */
  maxMetric: number | null;
  /** 발음 정확도 평균(0..100). 발화 항목 기록이 없으면 null */
  avgScore: number | null;
  /** 마지막 측정 시각(ISO). 없으면 null */
  lastAt: string | null;
}

export interface QabSummaryResult {
  items: QabSubtestSummary[];
}

/**
 * 퀴즈 도메인 서비스 (Phase 3).
 *
 * 설계 핵심:
 *  - 자동 트리거(generateForMemoryEntry)와 수동 트리거(requestGeneration)는
 *    공통 내부 로직 runGeneration을 공유한다.
 *  - LLM 호출 페이로드는 IQuizGenerationPayload 화이트리스트만 사용한다.
 *  - QuizError는 컨트롤러에서 HttpException으로 매핑된다 (서비스는 도메인 에러만 throw).
 */
@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    @InjectRepository(QuizSet)
    private readonly quizSetRepository: Repository<QuizSet>,
    @InjectRepository(QuizQuestion)
    private readonly quizQuestionRepository: Repository<QuizQuestion>,
    @InjectRepository(QuizAttempt)
    private readonly quizAttemptRepository: Repository<QuizAttempt>,
    @InjectRepository(QuizBestScore)
    private readonly quizBestScoreRepository: Repository<QuizBestScore>,
    @InjectRepository(QabResult)
    private readonly qabResultRepository: Repository<QabResult>,
    @InjectRepository(MemoryEntry)
    private readonly memoryEntryRepository: Repository<MemoryEntry>,
    @InjectRepository(PatientMemoryNote)
    private readonly patientMemoryNoteRepository: Repository<PatientMemoryNote>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(QUIZ_GENERATION_CLIENT)
    private readonly generationClient: IQuizGenerationClient,
    @Inject(QUIZ_SCORER)
    private readonly scorer: IQuizScorer,
    @Inject(WISH_CONVERSION_CLIENT)
    private readonly wishClient: IWishConversionClient,
    private readonly personaContext: PersonaContextService,
    private readonly fastApiClient: FastApiClientService,
  ) {}

  /**
   * 자동 트리거 진입점 (이벤트 리스너에서 호출).
   * - pending QuizSet을 만든 뒤 LLM 호출+영속화까지 동기 await 한다.
   *   (리스너 자체가 백그라운드 fire-and-forget이므로 await 해도 무방하다.)
   */
  async generateForMemoryEntry(
    memoryEntryId: string,
    opts?: { force?: boolean; requireCaregiverId?: string },
  ): Promise<{ quizSetId: string }> {
    const force = opts?.force ?? false;
    const requireCaregiverId = opts?.requireCaregiverId;

    const { quizSet, entry, notes, existing } = await this.prepareGeneration(
      memoryEntryId,
      force,
      requireCaregiverId,
    );

    // 기존 set 재사용 (자동 트리거에서 force 없이 이미 존재하는 경우)
    if (existing) {
      return { quizSetId: quizSet.id };
    }

    await this.runGeneration(quizSet, entry, notes);
    return { quizSetId: quizSet.id };
  }

  /**
   * 수동 트리거 진입점 (컨트롤러에서 호출).
   * - 권한 검증 + pending QuizSet 저장 후 즉시 반환한다.
   * - LLM 호출은 fire-and-forget(void)으로 백그라운드 수행한다.
   */
  async requestGeneration(
    memoryEntryId: string,
    caregiverId: string,
    force: boolean,
  ): Promise<RequestGenerationResult> {
    const { quizSet, entry, notes, existing } = await this.prepareGeneration(
      memoryEntryId,
      force,
      caregiverId,
    );

    // 기존 set 재사용 (force=true가 아니면 prepareGeneration이 ALREADY_EXISTS를 던지므로
    // 여기 도달 시 existing은 사실상 없으나, 방어적으로 처리)
    if (existing) {
      return { quizSetId: quizSet.id, generationStatus: 'pending' };
    }

    // fire-and-forget — 백그라운드 생성. 실패는 runGeneration 내부에서 failed로 기록.
    void this.runGeneration(quizSet, entry, notes).catch((error) => {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(
        `백그라운드 퀴즈 생성 실패 (quizSetId=${quizSet.id}): ${message}`,
      );
    });

    return { quizSetId: quizSet.id, generationStatus: 'pending' };
  }

  /**
   * 생성 준비 공통 로직: 엔트리/소유권/노트 검증 + pending QuizSet 확보.
   * - existing=true면 호출자가 LLM 호출 없이 기존 set을 그대로 반환해야 한다.
   */
  private async prepareGeneration(
    memoryEntryId: string,
    force: boolean,
    requireCaregiverId: string | undefined,
  ): Promise<{
    quizSet: QuizSet;
    entry: MemoryEntry;
    notes: PatientMemoryNote[];
    existing: boolean;
  }> {
    const entry = await this.memoryEntryRepository.findOne({
      where: { id: memoryEntryId, isActive: true },
    });
    if (!entry) {
      throw new QuizError(
        QuizErrorCode.MEMORY_ENTRY_NOT_FOUND,
        `메모리 엔트리를 찾을 수 없습니다: ${memoryEntryId}`,
      );
    }

    // 수동 트리거: 소유권 검증
    if (requireCaregiverId && entry.caregiverId !== requireCaregiverId) {
      throw new QuizError(
        QuizErrorCode.NOT_OWNER,
        '해당 메모리 엔트리에 대한 권한이 없습니다.',
      );
    }

    const notes = await this.patientMemoryNoteRepository.find({
      where: { memoryEntryId },
      order: { orderIndex: 'ASC' },
    });
    if (notes.length === 0) {
      throw new QuizError(
        QuizErrorCode.NO_PATIENT_NOTES,
        '환자 답변(PatientMemoryNote)이 1개 이상 필요합니다.',
      );
    }

    // 기존 QuizSet 존재 여부 (최신)
    const existingSet = await this.quizSetRepository.findOne({
      where: { memoryEntryId },
      order: { createdAt: 'DESC' },
    });

    // 재생성(기존 set 교체) 조건:
    //  - force=true (보호자 명시 재생성), 또는
    //  - 기존 set이 'failed' 상태 (실패한 퀴즈는 force 없이도 재시도 허용)
    const replaceExisting =
      !!existingSet && (force || existingSet.generationStatus === 'failed');

    if (existingSet && !replaceExisting) {
      // 수동 트리거(requireCaregiverId 존재) + 정상 set → 충돌 에러
      if (requireCaregiverId) {
        throw new QuizError(
          QuizErrorCode.QUIZ_SET_ALREADY_EXISTS,
          '이미 생성된 퀴즈가 있습니다. 재생성하려면 force 옵션을 사용하세요.',
        );
      }
      // 자동 트리거 → 조용히 기존 set 반환
      return { quizSet: existingSet, entry, notes, existing: true };
    }

    // 신규 pending QuizSet 저장.
    // 교체 시 동일 memoryEntry의 기존 set(들)을 같은 트랜잭션에서 먼저 삭제한다.
    // (FK ON DELETE CASCADE로 questions/attempts/best_scores가 함께 정리되어
    //  동일 라이프로그에 중복 QuizSet이 누적되는 것을 방지한다.)
    const quizSet = await this.dataSource.transaction(async (manager) => {
      const setRepo = manager.getRepository(QuizSet);
      if (replaceExisting) {
        await setRepo.delete({ memoryEntryId });
      }
      return setRepo.save(
        setRepo.create({
          memoryEntryId,
          patientId: entry.patientId,
          caregiverId: entry.caregiverId,
          generationStatus: 'pending',
          generationError: null,
          readyAt: null,
        }),
      );
    });

    return { quizSet, entry, notes, existing: false };
  }

  /**
   * LLM 호출 + QuizQuestion 영속화 + 상태 전이.
   * - 성공: status='ready', readyAt=now.
   * - 실패: status='failed', generationError=메시지, QuizError 재throw.
   */
  private async runGeneration(
    quizSet: QuizSet,
    entry: MemoryEntry,
    notes: PatientMemoryNote[],
  ): Promise<void> {
    // 시도 횟수를 '시작' 시점에 기록한다. 생성 도중 프로세스가 죽어도 카운트가
    // 남아야 부팅 복구가 같은 set을 영원히 재시도하지 않는다.
    await this.quizSetRepository.update(quizSet.id, {
      generationAttempts: (quizSet.generationAttempts ?? 0) + 1,
    });

    try {
      // 페르소나 토큰화: 가족 실명·지명이 외부 LLM(Gemini)에 그대로 나가지 않도록
      // [아들1]/[장소1] 토큰으로 치환한다. 프로필 미등록이면 빈 맵 → 원문 유지(무중단).
      const tokenMap = await this.buildTokenMapBestEffort(entry.patientId);

      // 마스킹: 프로필에 없는 PII(주소·기관명·미등록 지인 등)를 익명화한다.
      // 실패 시 생성을 중단한다(fail-closed) — 마스킹 없는 원문을 LLM에 보내지 않는다.
      // 시나리오 경로와 동일한 순서: 토큰화 → 마스킹 → LLM.
      const patientNotes = await this.maskNotes(notes, entry.id, tokenMap);

      const payload: IQuizGenerationPayload = {
        patientNotes,
        // 목표 단어는 보호자가 고른 훈련 어휘라 PII 위험이 낮아 마스킹하지 않는다
        // (실명이 섞였을 경우는 토큰화가 걸러낸다).
        targetWords:
          entry.targetWords && entry.targetWords.length > 0
            ? entry.targetWords.map((w) =>
                this.personaContext.tokenizeWithMap(w, tokenMap),
              )
            : undefined,
        distribution: DEFAULT_QUIZ_DISTRIBUTION,
        // photoTags는 R7=(c)에 따라 미전달 (Phase 2에서 R7=(b)로 전환)
      };

      const result = await this.generationClient.generate(payload);

      // 역치환: LLM이 돌려준 토큰을 실명으로 되돌린다.
      // 시나리오 경로(토큰 상태로 저장 후 표시 시 역치환)와 달리, 퀴즈는 정답이
      // 타일 분해·채점 비교·speech 노출 3곳에서 쓰이므로 저장 전에 되돌린다.
      // (DB는 이미 patient_memory_notes.answer_text에 평문 실명을 보관하므로
      //  새로운 PII 노출 클래스가 아니다. 경계는 외부 LLM이다.)
      const restored = this.restorePersonaQuestions(result.questions, tokenMap);

      // 빈칸(fill_blank)을 타일 조합/말하기로 변환 (고령 환자 타이핑 부담 제거).
      const diversified = this.diversifyRecallQuestions(restored);

      // 쓸 만한 문항이 하나도 안 남았으면 ready로 넘기지 않는다.
      // 0문항 set을 ready로 두면 환자는 문제 없는 퀴즈를 열고, submitAttempts의
      // completed(totalQuestions > 0 && ...)가 영영 false라 완료조차 못 한다.
      // failed로 마감해 복구(재생성) 경로를 타게 한다.
      if (diversified.length === 0) {
        throw new QuizError(
          QuizErrorCode.LLM_GENERATION_FAILED,
          '문제를 만들지 못했어요. 잠시 후 다시 시도해주세요.',
        );
      }

      // 문항 영속화 + ready 전이를 한 트랜잭션으로 묶어 원자성을 보장한다.
      // (questions만 저장되고 set이 pending에 박제되는 부분 상태를 방지)
      await this.dataSource.transaction(async (manager) => {
        const questionRepo = manager.getRepository(QuizQuestion);
        const setRepo = manager.getRepository(QuizSet);
        const questions = diversified.map((q, index) =>
          questionRepo.create({
            quizSetId: quizSet.id,
            orderIndex: index,
            type: q.type,
            prompt: q.prompt,
            choices: q.choices,
            correctAnswer: q.correctAnswer,
            hintFirstChar: q.hintFirstChar,
            explanation: null,
          }),
        );
        await questionRepo.save(questions);
        await setRepo.update(quizSet.id, {
          generationStatus: 'ready',
          readyAt: new Date(),
          generationError: null,
        });
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      await this.quizSetRepository.update(quizSet.id, {
        generationStatus: 'failed',
        generationError: message,
      });
      throw error;
    }
  }

  /**
   * 노트를 토큰화 → 마스킹하여 LLM 페이로드용 답변 텍스트를 만든다.
   *
   * 토큰화는 프로필에 등록된 가족·지명만 가린다. 그 밖의 PII(주소, 병원·기관명,
   * 등록되지 않은 지인 이름 등)는 /mask가 익명화한다.
   *
   * 노트별로 호출한다 — 여러 노트를 한 문자열로 이어 붙여 한 번에 마스킹하면
   * LLM이 구분자를 보존한다는 보장이 없어 되쪼개기가 깨질 수 있다.
   *
   * 다만 전부 동시에 쏘지 않고 동시성을 제한한다: 노트 5개를 병렬로 쏘면 곧바로
   * /quiz/generate까지 겹쳐 Gemini 레이트리밋(429/502)을 유발한다. 실제로 E2E에서
   * 이 버스트로 퀴즈 생성이 간헐 실패했다.
   *
   * 마스킹 실패는 삼키지 않는다(fail-closed): 호출자가 생성을 실패 처리한다.
   */
  private async maskNotes(
    notes: PatientMemoryNote[],
    memoryEntryId: string,
    tokenMap: Record<string, string>,
  ): Promise<IQuizGenerationPayload['patientNotes']> {
    const masked: Array<{
      category: PatientMemoryNote['category'];
      answerText: string;
    }> = [];

    for (let i = 0; i < notes.length; i += MASK_CONCURRENCY) {
      const chunk = notes.slice(i, i + MASK_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (note) => {
          const tokenized = this.personaContext.tokenizeWithMap(
            note.answerText,
            tokenMap,
          );
          const { maskedText } = await this.fastApiClient.mask(
            tokenized,
            memoryEntryId,
          );
          return { category: note.category, answerText: maskedText };
        }),
      );
      masked.push(...results);
    }

    return masked;
  }

  /**
   * 프로필 기반 tokenMap을 best-effort로 만든다.
   * 프로필 미등록·조회 실패 시 빈 맵 → 개인화만 생략하고 퀴즈 생성은 계속한다.
   */
  private async buildTokenMapBestEffort(
    patientId: string,
  ): Promise<Record<string, string>> {
    try {
      return await this.personaContext.buildTokenMap(patientId);
    } catch {
      return {};
    }
  }

  /**
   * LLM 산출 문항의 토큰([아들1])을 실명(민준)으로 되돌린다.
   *
   * 정답이 토큰이었다면 hintFirstChar가 '['가 되어버리므로, 정답이 실제로
   * 바뀐 경우에만 복원된 정답의 첫 글자로 다시 뽑는다.
   *
   * 역치환 후에도 대괄호 잔재가 남은 문항은 버린다 — LLM이 토큰을 훼손한
   * 것이므로 정상 복원이 불가능하다(§dropBrokenPersonaQuestions).
   */
  private restorePersonaQuestions(
    questions: GeneratedQuizQuestion[],
    tokenMap: Record<string, string>,
  ): GeneratedQuizQuestion[] {
    // 프로필이 없어도 잔재 검사는 반드시 돈다 — /mask가 만드는 Family_M1/Place_1
    // 라벨은 프로필 등록 여부와 무관하게 생기고, 그대로 두면 환자가 보게 된다.
    if (Object.keys(tokenMap).length === 0) {
      return this.dropArtifactQuestions(questions);
    }
    const restored = questions.map((q) => {
      const correctAnswer = this.personaContext.restorePersonaText(
        q.correctAnswer,
        tokenMap,
      );
      const answerChanged = correctAnswer !== q.correctAnswer;
      return {
        ...q,
        prompt: this.personaContext.restorePersonaText(q.prompt, tokenMap),
        choices:
          q.choices?.map((c) =>
            this.personaContext.restorePersonaText(c, tokenMap),
          ) ?? null,
        correctAnswer,
        hintFirstChar: answerChanged
          ? (correctAnswer.trim()[0] ?? null)
          : q.hintFirstChar,
      };
    });

    return this.dropArtifactQuestions(restored);
  }

  /**
   * 기계 잔재가 남은 문항을 제거한다 (환자 노출 차단).
   *
   * 두 경우 모두 실제로 관측된다:
   * - LLM이 페르소나 토큰을 쪼갬: [손자1] → [___1]. 역치환도 라벨 폴백도 못 걸린다.
   * - /mask 라벨을 그대로 문제에 씀: "Family_F1과 어디에 갔나요?".
   *   프로필에 없는 이름·장소는 마스킹되므로 프로필 등록 여부와 무관하게 생긴다.
   *
   * 프롬프트로도 금지하지만 LLM 준수를 믿지 않는다. 깨진 문항은 버린다 —
   * 문항 수가 줄어드는 편이 뜻 모를 문자열을 환자에게 보여주는 것보다 낫다.
   */
  private dropArtifactQuestions(
    questions: GeneratedQuizQuestion[],
  ): GeneratedQuizQuestion[] {
    const hasArtifact = (q: GeneratedQuizQuestion): boolean =>
      [q.prompt, q.correctAnswer, ...(q.choices ?? [])].some((text) =>
        RESIDUAL_ARTIFACT_PATTERN.test(text ?? ''),
      );

    const kept = questions.filter((q) => !hasArtifact(q));
    const dropped = questions.length - kept.length;
    if (dropped > 0) {
      this.logger.warn(
        `기계 잔재(훼손 토큰·마스킹 라벨)가 남은 문항 ${dropped}개를 제외했습니다.`,
      );
    }
    return kept;
  }

  /**
   * LLM이 만든 빈칸(fill_blank) 문항을 타일 조합/말하기로 번갈아 변환한다.
   *
   * 고령 실어증 환자의 타이핑 부담을 없애기 위해 fill_blank는 저장하지 않고,
   * 등장 순서대로 tile_arrange(짝수 번째) → speech(홀수 번째)로 변환한다.
   * (기본 분배 fill_blank=2 → 타일 1 + 말하기 1)
   *
   * - tile_arrange: 정답 음절 + 오답 음절을 섞은 타일을 choices에 담는다.
   *   (정답 음절이 비어 타일을 못 만들면 안전하게 speech로 폴백)
   * - speech: choices=null, hintFirstChar는 유지(STT 재시도 힌트로 활용).
   * - 그 외 유형(mc/yn)은 그대로 통과시킨다.
   */
  private diversifyRecallQuestions(
    questions: GeneratedQuizQuestion[],
  ): GeneratedQuizQuestion[] {
    let recallIndex = 0;
    return questions.map((q) => {
      if (q.type !== 'fill_blank') {
        return q;
      }
      const useTile = recallIndex % 2 === 0;
      recallIndex += 1;

      if (useTile) {
        const tiles = buildTiles(q.correctAnswer);
        if (tiles.length > 0) {
          return { ...q, type: 'tile_arrange', choices: tiles };
        }
      }
      // speech는 따라읽기(repetition): 빈칸 회상이 아니라 단어를 보여주고 따라 말한다.
      // prompt를 고정 안내로 교체하고, 읽을 단어는 correctAnswer로 유지(공개 DTO가 targetWord로 노출).
      return {
        ...q,
        type: 'speech',
        choices: null,
        prompt: SPEECH_REPEAT_PROMPT,
        hintFirstChar: null,
      };
    });
  }

  /**
   * 풀 수 있는 QuizSet 목록 조회 (createdAt DESC).
   */
  async listSets(
    effectivePatientId: string,
    filter: { memoryEntryId?: string; status?: string; limit?: number },
  ): Promise<QuizSetSummaryDto[]> {
    const qb = this.quizSetRepository
      .createQueryBuilder('set')
      .where('set.patient_id = :patientId', { patientId: effectivePatientId })
      .orderBy('set.created_at', 'DESC');

    if (filter.memoryEntryId) {
      qb.andWhere('set.memory_entry_id = :memoryEntryId', {
        memoryEntryId: filter.memoryEntryId,
      });
    }
    if (filter.status) {
      qb.andWhere('set.generation_status = :status', {
        status: filter.status,
      });
    }
    // limit 검증·캡: 유효한 양수만 허용(NaN/음수/0 → 기본 20), 상한 50.
    const rawLimit = filter.limit;
    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
    qb.take(limit);

    const sets = await qb.getMany();
    if (sets.length === 0) {
      return [];
    }

    const memoryEntryIds = sets.map((s) => s.memoryEntryId);
    const quizSetIds = sets.map((s) => s.id);

    const [entries, bestScores] = await Promise.all([
      this.memoryEntryRepository
        .createQueryBuilder('entry')
        .where('entry.id IN (:...ids)', { ids: memoryEntryIds })
        .getMany(),
      this.quizBestScoreRepository
        .createQueryBuilder('best')
        .where('best.quiz_set_id IN (:...ids)', { ids: quizSetIds })
        .getMany(),
    ]);

    const photoByEntry = new Map<string, string | null>(
      entries.map((e) => [e.id, e.photoUrl ?? null]),
    );
    const bestBySet = new Map<string, number>(
      bestScores.map((b) => [b.quizSetId, b.bestScore]),
    );

    return sets.map((set) => ({
      quizSetId: set.id,
      memoryEntryId: set.memoryEntryId,
      photoUrl: photoByEntry.get(set.memoryEntryId) ?? null,
      generationStatus: set.generationStatus,
      generationError:
        set.generationStatus === 'failed'
          ? (set.generationError ?? null)
          : null,
      bestScore: bestBySet.get(set.id) ?? null,
      createdAt: set.createdAt.toISOString(),
    }));
  }

  /**
   * 풀이용 단건 조회 (정답 은닉).
   */
  async getSetDetail(
    setId: string,
    effectivePatientId: string,
  ): Promise<QuizSetDetail> {
    const set = await this.findSetOrThrow(setId);
    this.verifyPatient(set, effectivePatientId);

    if (set.generationStatus !== 'ready') {
      throw new QuizError(
        QuizErrorCode.QUIZ_NOT_READY,
        '퀴즈가 아직 준비되지 않았습니다.',
      );
    }

    const [entry, notes, questions] = await Promise.all([
      this.memoryEntryRepository.findOne({
        where: { id: set.memoryEntryId },
      }),
      this.patientMemoryNoteRepository.find({
        where: { memoryEntryId: set.memoryEntryId },
        order: { orderIndex: 'ASC' },
      }),
      this.quizQuestionRepository.find({
        where: { quizSetId: set.id },
        order: { orderIndex: 'ASC' },
      }),
    ]);

    return {
      quizSetId: set.id,
      memoryEntry: {
        photoUrl: entry?.photoUrl ?? null,
        // Phase 6: 환자 본인 화면에만 노출 (verifyPatient로 소유권 검증 완료).
        caregiverWishMessage: entry?.caregiverWishMessage ?? null,
      },
      patientNotes: notes.map((note) => ({
        category: note.category,
        answerText: note.answerText,
      })),
      questions: questions.map(toQuizQuestionPublicDto),
    };
  }

  /**
   * 답안 제출 + 즉시 채점.
   * - 멱등: 동일 (sessionToken, questionId) attempt가 있으면 재채점/재저장하지 않는다.
   * - 세션 만료: 첫 답안 이후 30분 초과 시 SESSION_EXPIRED.
   */
  async submitAttempts(
    setId: string,
    effectivePatientId: string,
    dto: SubmitAttemptDto,
  ): Promise<SubmitAttemptsResult> {
    const set = await this.findSetOrThrow(setId);
    this.verifyPatient(set, effectivePatientId);

    if (set.generationStatus !== 'ready') {
      throw new QuizError(
        QuizErrorCode.QUIZ_NOT_READY,
        '퀴즈가 아직 준비되지 않았습니다.',
      );
    }

    const questions = await this.quizQuestionRepository.find({
      where: { quizSetId: set.id },
      order: { orderIndex: 'ASC' },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const totalQuestions = questions.length;

    // 동일 세션의 기존 attempt 조회 (멱등 + 세션 만료 판정)
    const existingAttempts = await this.quizAttemptRepository.find({
      where: { quizSetId: set.id, sessionToken: dto.sessionToken },
      order: { answeredAt: 'ASC' },
    });

    // 세션 만료: 가장 이른 answeredAt이 30분 초과
    if (existingAttempts.length > 0) {
      const earliest = existingAttempts[0].answeredAt.getTime();
      if (Date.now() - earliest > SESSION_TTL_MS) {
        throw new QuizError(
          QuizErrorCode.SESSION_EXPIRED,
          '풀이 세션이 만료되었습니다. 다시 시작해주세요.',
        );
      }
    }

    const answeredByQuestion = new Map(
      existingAttempts.map((a) => [a.questionId, a]),
    );

    // 답안 분류 + 채점. 신규 답안은 모아서 한 번에 저장한다(원자성 + N라운드트립 제거).
    // 동일 요청 내 중복 questionId는 1건만 저장하고 첫 채점 결과를 재사용한다.
    const results: AttemptResult[] = [];
    const newAttemptByQuestion = new Map<string, QuizAttempt>();

    for (const answer of dto.answers) {
      const question = questionById.get(answer.questionId);
      if (!question) {
        throw new QuizError(
          QuizErrorCode.INVALID_ANSWER_FORMAT,
          `해당 퀴즈에 속하지 않는 문제입니다: ${answer.questionId}`,
        );
      }

      // 멱등 — 이미 저장된 답안(이전 요청)
      const persisted = answeredByQuestion.get(question.id);
      if (persisted) {
        results.push({
          questionId: question.id,
          isCorrect: persisted.isCorrect,
          correctAnswer: question.correctAnswer,
        });
        continue;
      }

      // 동일 요청 내 중복 questionId — 첫 채점 결과 재사용
      const pendingNew = newAttemptByQuestion.get(question.id);
      if (pendingNew) {
        results.push({
          questionId: question.id,
          isCorrect: pendingNew.isCorrect,
          correctAnswer: question.correctAnswer,
        });
        continue;
      }

      const isCorrect = this.scorer.isCorrect(question, answer.userAnswer);
      newAttemptByQuestion.set(
        question.id,
        this.quizAttemptRepository.create({
          quizSetId: set.id,
          questionId: question.id,
          patientId: effectivePatientId,
          sessionToken: dto.sessionToken,
          userAnswer: answer.userAnswer,
          isCorrect,
        }),
      );
      results.push({
        questionId: question.id,
        isCorrect,
        correctAnswer: question.correctAnswer,
      });
    }

    // 신규 답안 일괄 저장 (단일 save 호출 = 배치 트랜잭션)
    const newAttempts = Array.from(newAttemptByQuestion.values());
    if (newAttempts.length > 0) {
      await this.quizAttemptRepository.save(newAttempts);
      for (const attempt of newAttempts) {
        answeredByQuestion.set(attempt.questionId, attempt);
      }
    }

    // 세션 전체 기준 정답 수 / 점수 (진행 중에도 환산)
    const correctCount = Array.from(answeredByQuestion.values()).filter(
      (a) => a.isCorrect,
    ).length;
    const answeredCount = answeredByQuestion.size;
    const sessionScore = this.scorer.toScore(correctCount, totalQuestions);
    const completed = totalQuestions > 0 && answeredCount === totalQuestions;

    if (!completed) {
      return { results, sessionScore, completed };
    }

    // 완료 시 최고 점수 갱신
    const { bestScore, isNewBest } = await this.upsertBestScore(
      set.id,
      effectivePatientId,
      dto.sessionToken,
      sessionScore,
    );

    return { results, sessionScore, completed, bestScore, isNewBest };
  }

  /**
   * 최고 점수 조회.
   */
  async getBestScore(
    setId: string,
    effectivePatientId: string,
  ): Promise<BestScoreResult> {
    const set = await this.findSetOrThrow(setId);
    this.verifyPatient(set, effectivePatientId);

    const best = await this.quizBestScoreRepository.findOne({
      where: { quizSetId: set.id },
    });

    if (!best) {
      return { quizSetId: set.id, bestScore: null };
    }
    return {
      quizSetId: set.id,
      bestScore: best.bestScore,
      achievedAt: best.achievedAt.toISOString(),
    };
  }

  /**
   * QAB 질문형 검사 결과 일괄 저장 (세션 완료 시 1회).
   * patientId는 토큰에서 도출된 유효 환자 ID를 사용한다(클라 입력 불신).
   */
  async saveQabResults(
    effectivePatientId: string,
    dto: SubmitQabResultsDto,
  ): Promise<SaveQabResultsResult> {
    const rows = dto.results.map((r) =>
      this.qabResultRepository.create({
        patientId: effectivePatientId,
        sessionToken: dto.sessionToken,
        subtest: r.subtest,
        itemRef: r.itemRef,
        isCorrect: r.isCorrect,
        assisted: r.assisted ?? false,
        metric: r.metric ?? null,
        score: r.score ?? null,
      }),
    );
    try {
      await this.qabResultRepository.save(rows);
    } catch (error) {
      // 멱등성: 같은 세션 재제출은 UNIQUE 위반 → 이미 저장된 것으로 보고 성공 처리.
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
    }
    return { saved: rows.length };
  }

  /**
   * QAB 검사별 회복 추적 요약 (보호자용).
   * 검사 종류별로 정확도 + 수치 지표(평균/최고) + 마지막 측정 시각을 집계한다.
   */
  async getQabSummary(
    effectivePatientId: string,
  ): Promise<QabSummaryResult> {
    const raw = await this.qabResultRepository
      .createQueryBuilder('r')
      // total/correct는 보호자 도움(assisted) 문항을 제외해 환자 실제 수행만 집계한다.
      .select('r.subtest', 'subtest')
      .addSelect('COUNT(*) FILTER (WHERE NOT r.assisted)', 'total')
      .addSelect(
        'SUM(CASE WHEN r.is_correct AND NOT r.assisted THEN 1 ELSE 0 END)',
        'correct',
      )
      .addSelect('SUM(CASE WHEN r.assisted THEN 1 ELSE 0 END)', 'assisted')
      .addSelect('AVG(r.metric)', 'avgMetric')
      .addSelect('MAX(r.metric)', 'maxMetric')
      .addSelect('AVG(r.score)', 'avgScore')
      .addSelect('MAX(r.created_at)', 'lastAt')
      .where('r.patient_id = :pid', { pid: effectivePatientId })
      .groupBy('r.subtest')
      .getRawMany<{
        subtest: string;
        total: string;
        correct: string;
        assisted: string;
        avgMetric: string | null;
        maxMetric: string | null;
        avgScore: string | null;
        lastAt: Date | string | null;
      }>();

    const items: QabSubtestSummary[] = raw.map((row) => {
      const total = Number(row.total);
      const correct = Number(row.correct);
      const assisted = Number(row.assisted);
      const avgMetric =
        row.avgMetric === null ? null : Math.round(Number(row.avgMetric) * 10) / 10;
      const maxMetric = row.maxMetric === null ? null : Number(row.maxMetric);
      const avgScore =
        row.avgScore === null ? null : Math.round(Number(row.avgScore));
      const lastAt =
        row.lastAt === null
          ? null
          : row.lastAt instanceof Date
            ? row.lastAt.toISOString()
            : new Date(row.lastAt).toISOString();
      return {
        subtest: row.subtest,
        total,
        correct,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
        assisted,
        avgMetric,
        maxMetric,
        avgScore,
        lastAt,
      };
    });

    return { items };
  }

  /**
   * 막힌 QuizSet 복구 (이벤트 durability 보강 + 일시 실패 구제).
   *
   * 두 종류를 되살린다:
   *
   * 1. 고아 pending — 자동 트리거는 in-process EventEmitter2 fire-and-forget이라,
   *    pending 저장 후 LLM 생성 완료 전 프로세스가 죽으면 'pending'에 영구히
   *    박제된다. STALE_PENDING_MS보다 오래된 것만 잡아 정상 진행 중인 생성은
   *    건드리지 않는다.
   *
   * 2. failed — 업스트림 일시 오류(Gemini 레이트리밋 등)로 실패한 set은
   *    재시도하면 대개 성공한다. 재시도가 없으면 보호자가 글을 써도 퀴즈가
   *    조용히 안 만들어진 채로 남는다.
   *
   * 무한 재시도 방지: generationAttempts가 MAX_GENERATION_ATTEMPTS에 도달한 set은
   * 제외한다. 노트 부족(422)처럼 영원히 실패할 콘텐츠가 매 부팅마다 LLM을 때리는
   * 것을 막는다. 상한을 넘긴 set은 수동 재생성(force)으로만 되살릴 수 있다.
   *
   * - 원본 라이프로그가 삭제됐거나 노트가 없으면 더 이상 생성 불가 → failed로 마감하고
   *   재시도 대상에서 영구 제외한다(attempts를 상한으로 올린다).
   * - 각 set 처리 실패는 다음 set 처리를 막지 않는다(독립적).
   */
  async recoverStuckSets(
    now: Date = new Date(),
  ): Promise<{ recovered: number; failed: number; skipped: number }> {
    const threshold = new Date(now.getTime() - STALE_PENDING_MS);
    const stale = await this.quizSetRepository.find({
      where: [
        {
          generationStatus: 'pending',
          createdAt: LessThan(threshold),
          generationAttempts: LessThan(MAX_GENERATION_ATTEMPTS),
        },
        {
          generationStatus: 'failed',
          generationAttempts: LessThan(MAX_GENERATION_ATTEMPTS),
        },
      ],
      order: { createdAt: 'ASC' },
      take: MAX_RECOVERY_BATCH,
    });

    if (stale.length === 0) {
      return { recovered: 0, failed: 0, skipped: 0 };
    }

    let recovered = 0;
    let failed = 0;
    for (const set of stale) {
      const entry = await this.memoryEntryRepository.findOne({
        where: { id: set.memoryEntryId, isActive: true },
      });
      if (!entry) {
        // 되살릴 방법이 없다 → 재시도 대상에서 영구 제외
        await this.quizSetRepository.update(set.id, {
          generationStatus: 'failed',
          generationError: '원본 라이프로그가 삭제되어 문제를 만들 수 없어요.',
          generationAttempts: MAX_GENERATION_ATTEMPTS,
        });
        failed += 1;
        continue;
      }

      const notes = await this.patientMemoryNoteRepository.find({
        where: { memoryEntryId: set.memoryEntryId },
        order: { orderIndex: 'ASC' },
      });
      if (notes.length === 0) {
        await this.quizSetRepository.update(set.id, {
          generationStatus: 'failed',
          generationError: '환자 답변이 없어 문제를 만들 수 없어요.',
          generationAttempts: MAX_GENERATION_ATTEMPTS,
        });
        failed += 1;
        continue;
      }

      try {
        await this.runGeneration(set, entry, notes);
        recovered += 1;
      } catch (error) {
        // runGeneration이 이미 status=failed로 기록함. 여기서는 집계만.
        const message =
          error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`QuizSet 복구 실패 (quizSetId=${set.id}): ${message}`);
        failed += 1;
      }
    }

    this.logger.log(
      `막힌 QuizSet 복구 완료 (recovered=${recovered}, failed=${failed}, scanned=${stale.length})`,
    );
    return { recovered, failed, skipped: 0 };
  }

  /**
   * 한마디→발화연습 변환 (Pattern 1, on-demand).
   * - 환자 본인 소유 검증 후, 해당 라이프로그의 caregiverWishMessage를 ai-service로 변환.
   * - 한마디가 없으면 NO_WISH_MESSAGE.
   * - FE가 보낸 텍스트를 신뢰하지 않고 DB의 한마디를 직접 읽어 변환한다(트러스트 경계).
   */
  async getWishPractice(
    setId: string,
    effectivePatientId: string,
  ): Promise<WishConversionResult> {
    const set = await this.findSetOrThrow(setId);
    this.verifyPatient(set, effectivePatientId);

    const entry = await this.memoryEntryRepository.findOne({
      where: { id: set.memoryEntryId },
    });
    const wishMessage = entry?.caregiverWishMessage?.trim();
    if (!wishMessage) {
      throw new QuizError(
        QuizErrorCode.NO_WISH_MESSAGE,
        '이 기록에는 보호자 한마디가 없어요.',
      );
    }

    return this.wishClient.convert(wishMessage);
  }

  // ─── 내부 헬퍼 ─────────────────────────────────────────────────────

  /**
   * QuizBestScore upsert — 신규이거나 **더 높은 점수일 때만** 갱신.
   *
   * 동시 완료(더블클릭/네트워크 재시도)로 두 요청이 동시에 도달해도 안전하도록
   * 원자적으로 처리한다:
   *   1) 행이 없으면 INSERT 시도. 동시 INSERT 충돌(UNIQUE 위반, PG 23505)은
   *      삼키고 (2) 조건부 UPDATE 경로로 폴백한다.
   *   2) `best_score < :score` 조건의 단일 UPDATE 문(행 레벨 원자성)으로 갱신.
   *      affected>0 이면 새 최고점이다.
   */
  private async upsertBestScore(
    quizSetId: string,
    patientId: string,
    sessionToken: string,
    sessionScore: number,
  ): Promise<{ bestScore: number; isNewBest: boolean }> {
    const existing = await this.quizBestScoreRepository.findOne({
      where: { quizSetId },
    });

    if (!existing) {
      try {
        await this.quizBestScoreRepository.save(
          this.quizBestScoreRepository.create({
            quizSetId,
            patientId,
            bestScore: sessionScore,
            bestSessionToken: sessionToken,
          }),
        );
        return { bestScore: sessionScore, isNewBest: true };
      } catch (error) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }
        // 동시 INSERT 충돌 → 아래 조건부 UPDATE 경로로 폴백
      }
    }

    // 조건부 원자적 UPDATE: 기존보다 높을 때만 갱신
    const updateResult = await this.quizBestScoreRepository
      .createQueryBuilder()
      .update(QuizBestScore)
      .set({
        bestScore: sessionScore,
        bestSessionToken: sessionToken,
        achievedAt: () => 'now()',
      })
      .where('quiz_set_id = :quizSetId', { quizSetId })
      .andWhere('best_score < :sessionScore', { sessionScore })
      .execute();

    const isNewBest = (updateResult.affected ?? 0) > 0;

    // 최종 현재값 조회 (동시 갱신 결과 반영)
    const current = await this.quizBestScoreRepository.findOne({
      where: { quizSetId },
    });
    return {
      bestScore: current?.bestScore ?? sessionScore,
      isNewBest,
    };
  }

  /** PostgreSQL UNIQUE 제약 위반(23505) 판별 */
  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const code = (error as { code?: string }).code;
    const driverCode = (error as { driverError?: { code?: string } })
      .driverError?.code;
    return code === '23505' || driverCode === '23505';
  }

  private async findSetOrThrow(setId: string): Promise<QuizSet> {
    const set = await this.quizSetRepository.findOne({ where: { id: setId } });
    if (!set) {
      throw new QuizError(
        QuizErrorCode.QUIZ_SET_NOT_FOUND,
        `퀴즈 셋을 찾을 수 없습니다: ${setId}`,
      );
    }
    return set;
  }

  private verifyPatient(set: QuizSet, effectivePatientId: string): void {
    if (set.patientId !== effectivePatientId) {
      throw new QuizError(
        QuizErrorCode.FORBIDDEN,
        '해당 퀴즈에 대한 접근 권한이 없습니다.',
      );
    }
  }

}
