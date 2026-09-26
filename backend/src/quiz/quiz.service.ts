import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { FastApiClientService } from '../memory/services/fast-api-client.service';
import { PersonaContextService } from '../profile/services/persona-context.service';
import { User } from '../auth/entities/user.entity';
import {
  DEFAULT_TIMEZONE,
  DEFAULT_WEEK_START,
  dayBucket,
  dayWindowStart,
  weekBucket,
  weekWindowStart,
} from '../common/week-boundary';
import { DEFAULT_QUIZ_DISTRIBUTION } from './constants/quiz-distribution';
import { QAB_LEGACY_SCORER_VERSION } from './constants/qab-scorer';
import { QuizSetSummaryDto } from './dto/quiz-set-summary.dto';
import {
  QuizQuestionPublicDto,
  toQuizQuestionPublicDto,
} from './dto/quiz-question-public.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitQabResultsDto } from './dto/submit-qab-results.dto';
import { QabResult } from './entities/qab-result.entity';
import { QabSessionCompletion } from './entities/qab-session-completion.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { SkillLevel } from './entities/skill-level.entity';
import {
  QAB_MANIFEST_VERSION,
  QAB_SUBTESTS,
  type QabSubtest,
} from './constants/qab-subtest';
import {
  COLD_START_LEVEL,
  MAX_LEVEL,
  MIN_LEVEL,
  type SkillLevel as SkillLevelValue,
} from './services/skill-leveling';
import { QuizError, QuizErrorCode } from './errors/quiz.errors';
import {
  GeneratedQuizQuestion,
  IQuizGenerationClient,
  QUIZ_GENERATION_CLIENT,
} from './interfaces/IQuizGenerationClient';
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
 * QAB 결과의 `answeredAt`(푼 시각)으로 받아들이는 가장 오래된 과거(OV-B).
 * 재전송 대기열의 TTL과 같다 — 그보다 오래된 결과는 정상 클라이언트가 보내지
 * 않는다. 더 오래된 값이 오면 이 경계로 접는다(기기 시계 오류 방어).
 */
const ANSWERED_AT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

/**
 * GET /quiz/session-stats 반환 타입 — 세션 완료율(보호자용).
 *
 * started는 "결과가 한 문항이라도 남은 세션"이다. 세션을 열기만 하고 한 문항도
 * 안 푼 경우는 qab_results에 행이 없어 분모에 들어가지 않는다 — 우연한 진입을
 * 이탈로 세지 않기 위함이다.
 */
/** 최근 문항 성적 1건 (재출제 우선순위 산출용). */
export interface WeekReviewNote {
  category: 'activity' | 'moment' | 'context';
  text: string;
}

export interface WeekReviewItemResult {
  quizSetId: string;
  memoryEntryId: string;
  /** 사진 경로. 없으면 null — 그때는 notes가 카드를 채운다. */
  photoUrl: string | null;
  /**
   * 보호자가 적은 그날의 답변(순서대로). 사진이 없으면 이것이 회상 재료다.
   *
   * `category`를 함께 보낸다. `moment`(그 순간)가 실제 기억이고 `activity`·
   * `context`는 한두 낱말짜리 태그다 — 셋을 같은 크기로 늘어놓으면 태그가
   * 문장 조각처럼 읽힌다.
   */
  notes: WeekReviewNote[];
  lastPlayedAt: string;
}

export interface RecentItemResult {
  itemRef: string;
  /** 최근 N일 동안 한 번이라도 맞혔는가. false면 재출제 우선순위가 높다. */
  /** 가장 최근 시도의 정오답. "한 번이라도 맞았나"가 아니다 — 훈련에 필요한 신호는 최신 상태다. */
  lastCorrect: boolean;
  lastAt: string;
}

export interface SessionStatsResult {
  started: number;
  completed: number;
  /** 0..100. started가 0이면 null(비율을 지어내지 않는다). */
  completionRate: number | null;
  /**
   * 미완료(이탈) 세션이 평균 몇 문항까지 갔는지(소수 1자리). 이탈이 없으면 null.
   *
   * 완료율만으로는 "대부분 끝까지 가다 지쳐서 남긴 것"과 "시작하자마자 나간 것"이
   * 같은 숫자로 보이는데, 대응은 정반대다(전자=세션이 길다, 후자=초반이 어렵다).
   */
  avgItemsBeforeDropoff: number | null;
}

/** GET /quiz/skill-levels 반환 타입 — 스킬별 현재 레벨(콜드스타트 채움) + 매니페스트 버전. */
export interface SkillLevelsResult {
  levels: Record<QabSubtest, number>;
  manifestVersion: number;
}

/** QAB 검사별 회복 추적 요약 (보호자용) */
export interface QabSubtestSummary {
  subtest: string;
  /** 보호자 도움(assisted)·채점 불가(unscored)를 뺀 실제 채점된 응답 수 */
  total: number;
  correct: number;
  /** 0..100 정확도 (도움·채점 불가 제외 기준) */
  accuracy: number;
  /** 보호자가 넘어가기로 통과시킨 문항 수 */
  assisted: number;
  /**
   * 음향 발음 평가를 얻지 못해 채점하지 못한 문항 수. total에 포함되지 않는다.
   *
   * 오답이 아니라 측정 실패다. 이 수가 커지면 정확도가 아니라 **채점 경로**를
   * 의심해야 한다 — 그래서 숨기지 않고 내보낸다.
   */
  unscored: number;
  /**
   * 채점 불가 중 **이웃 비교에서 재시도까지 했는데 못 가른** 문항 수(`unscored`의 부분집합).
   *
   * `unscored - unscoredAmbiguous`는 채점 서버에 못 닿은 쪽이다. 둘을 갈라 보여야 모호율이
   * 높은 것(판정 규칙)과 채점 경로가 흔들린 것을 구분한다.
   */
  unscoredAmbiguous: number;
  /**
   * 이 검사의 기록에 나타난 채점기 버전(중복 없음, 정렬). NULL 행은 `azure-pa-v1`로 센다.
   *
   * 둘 이상이면 정답률 추이가 **전환을 넘어 이어진 것**이다 — 채점기가 바뀌면 같은 수행이 다른
   * 점수를 받으므로 그 꺾임은 환자가 아니라 자의 변화일 수 있다. 화면이 이 값으로 알린다.
   */
  scorerVersions: string[];
  /**
   * 옛 채점기(`azure-pa-v1`)가 아닌 채점기가 **처음** 쓰인 시각(ISO). 전환이 없으면 null.
   * 화면이 "채점 방식이 바뀌었어요(날짜)"를 그릴 때 쓴다.
   */
  scorerChangedAt: string | null;
  /**
   * 이웃 비교를 거친 시도 수(`ambiguous_retries`가 NULL이 아닌 행). 1차 모호율의 분모다.
   * 채점 불가·도움받음도 센다 — 환자가 "한 번 더"를 들었는지는 그 결과와 무관하다.
   */
  neighborAttempts: number;
  /**
   * 그중 1차에 모호해서 다시 말하게 한 수. `neighborRetried / neighborAttempts`가 1차 모호율이다
   * (설계 채택 기준 ≤ 15%). 재시도 후에도 못 가른 것은 `unscoredAmbiguous`다.
   */
  neighborRetried: number;
  /** 수치 지표 평균(ddk 등). 없으면 null */
  avgMetric: number | null;
  /** 수치 지표 최고값(ddk 최고 횟수 등). 없으면 null */
  maxMetric: number | null;
  /** 발음 정확도 평균(0..100). 발화 항목 기록이 없으면 null */
  avgScore: number | null;
  /** 마지막 측정 시각(ISO). 없으면 null */
  lastAt: string | null;
  /**
   * 오답을 갈래별로 센 것 — 단어 이해에만 값이 있다.
   *
   * 정답률은 "몇 개 틀렸나"까지만 말한다. 무엇이 어려운지는 **어떤 오답을
   * 골랐나**가 말한다. 의미 유인지를 반복해 고르면 의미 체계 쪽, 음운 유인지면
   * 음운 처리 쪽이다.
   *
   * 갈래를 안 남긴 오답(맞힌 문항, 컬럼 이전의 옛 행, 문장 이해)은 세지 않는다.
   * 셋 다 0이면 null — 볼 것이 없다는 뜻이고, 0으로 채운 막대를 그리면 없는
   * 사실이 생긴다.
   *
   * **주의: 음운 유인지는 눈높이 4단계부터 나온다**(`LEVEL_CHOICE_SPEC`).
   * 그 아래에서는 고를 기회 자체가 없어 0이 손상 없음을 뜻하지 않는다.
   */
  foilKinds: {
    semantic: number;
    phonological: number;
    unrelated: number;
  } | null;
  /**
   * 이름대기에서 **평균 몇 칸을 도왔나**(E18). 0에 가까울수록 스스로 한다.
   *
   *   0 무단서 · 1 의미 단서 · 3 음소 단서 · 4 정답을 알려줌
   *
   * 정답률과 재는 것이 다르다. 정답률은 `assisted`를 빼고 "도움 없이 몇 %"를
   * 말하는데, 도움이 필요한 환자는 그 분모가 거의 비어 값이 안 나온다. 이 값은
   * 그 도움 자체를 센다 — 4에서 3, 3에서 1로 내려오는 것이 회복이다.
   *
   * 표본이 없으면 null. 0으로 내려보내면 화면이 "평균 0단계"(늘 스스로 맞혔다)
   * 라는 없는 사실을 그린다.
   */
  avgCueLevel: number | null;
  /**
   * 위 평균이 몇 문항에서 나왔나.
   *
   * 이 기능 이전의 이름대기 기록은 `cue_level`이 NULL이라 여기 안 들어간다.
   * `assisted` 불리언만으로는 몇 단계였는지 복원할 수 없어서다.
   */
  cueScored: number;
}

export interface QabSummaryResult {
  items: QabSubtestSummary[];
}

/** 한 검사의 특정 주차 성적. */
export interface QabWeeklyPoint {
  /** 그 주 월요일 (YYYY-MM-DD). 그래프의 x축이 된다. */
  weekStart: string;
  total: number;
  correct: number;
  /** 0~100 정수. loc는 정답률이 아니라 반응률이다. */
  accuracy: number;
  /** loc의 평균 의식 수준 점수(0~3), 발화 항목의 평균 발음 점수(0~100). */
  avgScore: number | null;
  /** ddk의 평균 감지 횟수(음절 반복 수). 소수 1자리. 발화·이해 검사는 null. */
  avgMetric: number | null;
}

/** 검사별 주차 추이. */
export interface QabTrendSeries {
  subtest: string;
  /** 오래된 주부터. 비어 있을 수 있다(그 검사를 아직 안 함). */
  points: QabWeeklyPoint[];
  /**
   * 직전 주 대비 정답률 변화(%p). 주가 2개 미만이면 null.
   * 보호자가 "나아지고 있나"를 한눈에 보는 값이다.
   */
  deltaFromPrevious: number | null;
}

export interface QabTrendResult {
  series: QabTrendSeries[];
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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(SkillLevel)
    private readonly skillLevelRepository: Repository<SkillLevel>,
    @InjectRepository(QabSessionCompletion)
    private readonly qabSessionCompletionRepository: Repository<QabSessionCompletion>,
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

    // 시도 횟수 기록(원자적). 방금 만든 set이라 경합은 없지만, 생성 도중 죽어도
    // 카운트가 남아야 부팅 복구가 무한 재시도하지 않는다.
    await this.quizSetRepository.increment(
      { id: quizSet.id },
      'generationAttempts',
      1,
    );
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
    // 시도 횟수 증가는 호출자가 담당한다(신규는 increment, 복구는 claim의 조건부
    // UPDATE). 여기서 read-modify-write하면 동시 실행 시 카운트가 유실된다.
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
        // 복구 재생성 시 이전 시도가 남긴 문항을 먼저 지운다. 안 지우면 5문항 set이
        // 10문항이 되고, submitAttempts의 completed(totalQuestions 기준)가 깨진다.
        await questionRepo.delete({ quizSetId: quizSet.id });
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
   * LLM이 만든 빈칸(fill_blank) 문항을 말하기(따라읽기)로 변환한다.
   *
   * 고령 실어증 환자의 타이핑 부담을 없애기 위해 fill_blank는 저장하지 않는다.
   *
   * **음절 타일(tile_arrange)은 여기서 만들지 않는다.** 예전에는 빈칸을 번갈아
   * 타일/말하기로 바꿨는데, 그러면 한 문항이 기억 회상과 음절 조합을 동시에
   * 물어 틀렸을 때 무엇을 못한 건지 분리되지 않았다. 게다가 보호자 메모에서
   * 매일 새 문항이 나와 같은 목표가 반복되지 않고(실어증 치료 이득은 훈련한
   * 그 항목에 국한된다), 난이도가 제각각이라 적응 레벨링이 붙을 자리도 없었다.
   *
   * 타일 과제는 커리큘럼 단어 풀 기반의 독립 검사(subtest `spell`)로 옮겼다.
   * 거기서는 레벨이 방해 타일 수를 정하고 같은 단어가 여러 세션에 반복된다.
   * 이미 저장된 tile_arrange 문항은 그대로 렌더링된다(유형은 유지).
   *
   * - speech: choices=null, prompt는 고정 안내, 읽을 단어는 correctAnswer로 유지.
   * - 그 외 유형(mc/yn)은 그대로 통과시킨다.
   */
  private diversifyRecallQuestions(
    questions: GeneratedQuizQuestion[],
  ): GeneratedQuizQuestion[] {
    return questions.map((q) => {
      if (q.type !== 'fill_blank') {
        return q;
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
   * 최근 N일 동안 **환자가 실제로 푼** 기억들 — 환자용 돌아보기 화면.
   *
   * **점수를 담지 않는다.** 환자 화면은 정답률을 보여주지 않는 것이 이 앱의 원칙이고
   * (`QuizScreen`이 `showScore={false}`로 넘긴다), 돌아보기의 목적은 평가가 아니라
   * 회상이다. 무엇을 함께 봤는지만 돌려준다.
   *
   * **"만든" 기억이 아니라 "푼" 기억이다.** `quiz_sets.created_at`으로 거르면 보호자가
   * 이번 주에 등록만 하고 환자는 안 푼 기억이 섞인다 — 화면 이름이 돌아보기인데
   * 하지 않은 것이 올라온다. 그래서 `quiz_attempts.answered_at`을 기준으로 잡는다.
   *
   * 사진이 없는 기억은 글이 대신한다. 기억은 **사진 아니면 글 중 하나가 반드시 있다**
   * (`memory.service.ts`가 생성 시점에 강제한다). 그래서 빈 카드는 나올 수 없다.
   * 질문 문구는 안 담는다 — 보호자가 답을 쓰게 하는 발판이지 환자가 볼 내용이
   * 아니고, 넣으면 카드가 설문지처럼 보인다.
   */
  async getWeekReview(
    effectivePatientId: string,
    days = 7,
  ): Promise<WeekReviewItemResult[]> {
    // 기억당 마지막으로 푼 시각. 같은 기억을 여러 번 풀어도 카드는 하나다.
    const played = await this.quizAttemptRepository
      .createQueryBuilder('a')
      .select('s.memory_entry_id', 'memoryEntryId')
      .addSelect('MAX(a.answered_at)', 'lastPlayedAt')
      .addSelect('MAX(s.id::text)', 'quizSetId')
      .innerJoin(QuizSet, 's', 's.id = a.quiz_set_id')
      .where('a.patient_id = :pid', { pid: effectivePatientId })
      .andWhere('a.answered_at >= now() - make_interval(days => :days)', {
        days,
      })
      .groupBy('s.memory_entry_id')
      .orderBy('MAX(a.answered_at)', 'DESC')
      .getRawMany<{
        memoryEntryId: string;
        lastPlayedAt: Date;
        quizSetId: string;
      }>();

    if (played.length === 0) return [];

    const memoryEntryIds = played.map((p) => p.memoryEntryId);
    const [entries, notes] = await Promise.all([
      this.memoryEntryRepository
        .createQueryBuilder('entry')
        .where('entry.id IN (:...ids)', { ids: memoryEntryIds })
        .getMany(),
      this.patientMemoryNoteRepository
        .createQueryBuilder('note')
        .where('note.memory_entry_id IN (:...ids)', { ids: memoryEntryIds })
        .orderBy('note.order_index', 'ASC')
        .getMany(),
    ]);

    const photoByEntry = new Map<string, string | null>(
      entries.map((e) => [e.id, e.photoUrl ?? null]),
    );
    const notesByEntry = new Map<string, WeekReviewNote[]>();
    for (const n of notes) {
      const list = notesByEntry.get(n.memoryEntryId) ?? [];
      list.push({ category: n.category, text: n.answerText });
      notesByEntry.set(n.memoryEntryId, list);
    }

    return played.map((p) => ({
      quizSetId: p.quizSetId,
      memoryEntryId: p.memoryEntryId,
      photoUrl: photoByEntry.get(p.memoryEntryId) ?? null,
      notes: notesByEntry.get(p.memoryEntryId) ?? [],
      lastPlayedAt: new Date(p.lastPlayedAt).toISOString(),
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
   * QAB 질문형 검사 결과 저장 (ADP-001로 문항마다 점진 제출).
   * patientId는 토큰에서 도출된 유효 환자 ID를 사용한다(클라 입력 불신).
   */
  async saveQabResults(
    effectivePatientId: string,
    dto: SubmitQabResultsDto,
  ): Promise<SaveQabResultsResult> {
    // 클라이언트가 낸 문항 풀 버전. 행에 그대로 남긴다(M23) — 서버 상수로
    // 덮어쓰면 옛 클라이언트가 낸 문항이 새 풀 기준으로 기록돼 경계가 사라진다.
    const r_manifest = dto.manifestVersion ?? null;

    // 버전 불일치는 거부하지 않고 경고만 남긴다. 배포 직후에는 옛 번들을 들고
    // 있는 클라이언트가 정상적으로 존재한다.
    if (
      dto.manifestVersion !== undefined &&
      dto.manifestVersion !== QAB_MANIFEST_VERSION
    ) {
      this.logger.warn(
        `QAB manifest 버전 불일치: client=${dto.manifestVersion} server=${QAB_MANIFEST_VERSION} (patient=${effectivePatientId})`,
      );
    }

    // 제출에 등장한 서브테스트만 레벨 재계산 대상.
    const affectedSubtests = [...new Set(dto.results.map((r) => r.subtest))];

    // 세션 시작 시점의 레벨. 클라이언트가 보낸 값의 허용 범위를 이걸로 정한다.
    const affectedAndReported = [
      ...new Set([
        ...affectedSubtests,
        ...(Object.keys(dto.levels ?? {}) as QabSubtest[]),
      ]),
    ];
    const currentLevelRows = affectedAndReported.length
      ? await this.skillLevelRepository.find({
          where: {
            patientId: effectivePatientId,
            subtest: In(affectedAndReported),
          },
        })
      : [];
    const currentLevelBySubtest = new Map(
      currentLevelRows.map((row) => [row.subtest, row.level]),
    );
    const storedLevel = (subtest: QabSubtest): SkillLevelValue =>
      (currentLevelBySubtest.get(subtest) ??
        COLD_START_LEVEL) as SkillLevelValue;

    /**
     * 클라이언트 값을 저장된 레벨 ±1 · [1..5]로 접는다.
     *
     * 세션 내 적응(D7-C) 이후 **무엇을 냈는지 아는 쪽은 프론트뿐이다.** 같은
     * 세션에서 눈높이가 내려가면 서버가 가진 레벨과 달라지고, 그때 서버값으로
     * 덮어쓰면 기록이 거짓이 된다. 그래서 클라이언트 값을 받는다.
     *
     * 그렇다고 그대로 믿지는 않는다. 적응 규칙이 **세션당 한 칸**이므로 정상
     * 클라이언트는 ±1을 넘지 않는다. 넘으면 접고 경고를 남긴다 — 조작이든
     * 배선 버그든 레벨이 한 번에 튀지 않게 하는 상한이다.
     */
    const acceptLevel = (
      subtest: QabSubtest,
      claimed: number | undefined,
      what: string,
    ): SkillLevelValue => {
      const stored = storedLevel(subtest);
      if (claimed === undefined) return stored;
      const bounded = Math.max(
        Math.max(MIN_LEVEL, stored - 1),
        Math.min(Math.min(MAX_LEVEL, stored + 1), Math.round(claimed)),
      );
      if (bounded !== claimed) {
        this.logger.warn(
          `${what} 범위 밖: client=${claimed} stored=${stored} → ${bounded} ` +
            `(patient=${effectivePatientId}, subtest=${subtest})`,
        );
      }
      return bounded as SkillLevelValue;
    };

    /**
     * 클라이언트가 찍은 "푼 시각"을 받는다(OV-B). 안 보냈으면 undefined —
     * DB 기본값 now()가 들어간다(옛 클라이언트, 지금 동작 그대로).
     *
     * 기기 시계는 틀릴 수 있어 `[지금 − 24h, 지금]`으로 접는다. 미래 시각을 그대로
     * 두면 아직 안 온 날에 수행이 찍힌다. 24h보다 오래된 것은 재전송 대기열의
     * TTL을 넘은 것이라 정상 클라이언트는 보내지 않는다 — 접되 경고를 남긴다.
     */
    const now = Date.now();
    const acceptAnsweredAt = (iso: string | undefined): Date | undefined => {
      if (iso === undefined) return undefined;
      const claimed = new Date(iso).getTime();
      const bounded = Math.min(
        now,
        Math.max(now - ANSWERED_AT_MAX_AGE_MS, claimed),
      );
      if (bounded !== claimed) {
        this.logger.warn(
          `answeredAt 범위 밖: client=${iso} → ${new Date(bounded).toISOString()} ` +
            `(patient=${effectivePatientId})`,
        );
      }
      return new Date(bounded);
    };

    const rows = dto.results.map((r) => {
      const serverLevel = acceptLevel(
        r.subtest,
        r.presentedLevel,
        'presented_level',
      );
      // 채점 불가면 점수를 받지 않는다. "못 쟀다"고 표시해 놓고 점수를 함께
      // 보내면 그 점수가 발음 평균(AVG(score))에 섞여 들어간다 — 플래그의
      // 목적이 정확히 그걸 막는 것이다. 클라이언트를 믿지 않고 서버가 지운다.
      const unscored = r.unscored ?? false;
      return this.qabResultRepository.create({
        patientId: effectivePatientId,
        sessionToken: dto.sessionToken,
        subtest: r.subtest,
        itemRef: r.itemRef,
        isCorrect: r.isCorrect,
        unscored,
        // 이유는 채점 불가일 때만 남긴다. 채점된 행에 이유가 붙으면 "채점됐는데 못 잰
        // 이유가 있는 행"이 생겨 unscored 집계와 어긋난다 — score를 지우는 것과 같은 이유다.
        unscoredReason: unscored ? (r.unscoredReason ?? null) : null,
        // 클라이언트가 낸 채점기 버전을 그대로 남긴다. 안 보내면 NULL = azure-pa-v1이다.
        // 서버 상수로 채우면 옛 클라이언트의 행이 새 채점기로 기록된 것처럼 보인다.
        scorerVersion: r.scorerVersion ?? null,
        // 이름대기만 보낸다. 다른 검사에서 오면 뜻이 없으므로 떨군다 — cueLevel과 같은 이유다.
        ambiguousRetries:
          r.subtest === 'naming' ? (r.ambiguousRetries ?? null) : null,
        // 단서를 한 칸이라도 받았으면 assisted도 참이다(E18). 기존 통계가
        // `NOT r.assisted`로 거르고 있어 그 뜻을 유지해야 마이그레이션이 무해하다.
        // 클라이언트가 assisted만 보내던 시절의 요청도 그대로 동작한다.
        assisted: (r.assisted ?? false) || (r.cueLevel ?? 0) >= 1,
        // 이름대기만 보낸다. 다른 검사에서 오면 뜻이 없으므로 떨군다 —
        // foilKind를 정답 행에서 떨구는 것과 같은 이유다.
        cueLevel: r.subtest === 'naming' ? (r.cueLevel ?? null) : null,
        metric: r.metric ?? null,
        score: unscored ? null : (r.score ?? null),
        // score와 같은 규약 — 채점 불가면 세부 점수도 없다(M24).
        accuracyScore: unscored ? null : (r.accuracyScore ?? null),
        completenessScore: unscored ? null : (r.completenessScore ?? null),
        fluencyScore: unscored ? null : (r.fluencyScore ?? null),
        presentedLevel: serverLevel,
        // 갈래는 **틀린 문항에만** 남는다. 맞힌 행에 갈래가 붙으면 "오답이
        // 아닌데 오답 갈래가 있는 행"이 생겨 집계가 조용히 틀린다. 프론트가
        // 안 보내는 것이 정상이지만 여기서도 떨군다.
        foilKind: r.isCorrect ? null : (r.foilKind ?? null),
        // 관측값 그대로 저장한다. 안 보내면 NULL — "폴백 아님"이 아니라 "모름"이다.
        bandFallback: r.bandFallback ?? null,
        stimulusKind: r.stimulusKind ?? null,
        // 클라이언트가 보낸 버전을 그대로 남긴다. 서버 상수로 덮어쓰면 안 된다 —
        // 옛 클라이언트가 낸 문항이 새 풀 기준으로 기록돼 경계가 사라진다.
        manifestVersion: r_manifest,
        answeredAt: acceptAnsweredAt(r.answeredAt),
      });
    });

    // insert + 레벨 재계산 + UPSERT를 단일 트랜잭션으로. 재계산은 현재 레벨에서
    // 제시된 최근 윈도우로 결정론적이라, 중복/재시도 제출이 레벨을 이중으로
    // 움직이지 않는다(dedup UNIQUE가 insert를 no-op으로 만들고 윈도우는 동일).
    //
    // 멱등은 **DB가 제공하게 한다** — `ON CONFLICT DO NOTHING`.
    //
    // 예전에는 `manager.save()`를 try/catch로 감싸 UNIQUE 위반을 삼켰는데,
    // PostgreSQL에서 그건 멱등이 아니다. 트랜잭션 안에서 에러가 나면 그 트랜잭션은
    // **abort 상태**가 되어 ROLLBACK 전까지 후속 명령이 전부 25P02로 실패한다.
    // 즉 잡아도 소용이 없고, 바로 아래 레벨 재계산과 완료 마커가 같이 죽어
    // 재제출한 세션의 결과가 통째로 롤백됐다. 주석은 "재계산은 그대로 진행"이라고
    // 단언하고 있었다. 애초에 예외를 안 내는 것이 유일하게 맞는 방법이다.
    await this.dataSource.transaction(async (manager) => {
      // rows가 빌 수 있다: 세션 끝에 보낼 tail이 없고 완료 마커만 보내는 제출.
      // 빈 values()는 TypeORM이 거부하므로 건너뛴다 — 아래 완료 마커는 그대로
      // 남겨야 한다. 그게 이 경로의 존재 이유다.
      if (rows.length > 0) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(QabResult)
          .values(rows)
          .orIgnore()
          .execute();
      }
      // 레벨은 **세션이 끝날 때 한 번만** 움직인다. 점진 제출의 중간 flush마다
      // 반영하면 한 세션이 레벨을 여러 번 민다.
      if (dto.completed && dto.levels) {
        for (const [subtest, claimed] of Object.entries(dto.levels) as [
          QabSubtest,
          number,
        ][]) {
          const next = acceptLevel(subtest, claimed, '세션 종료 레벨');
          // 변화가 없으면 쓰지 않는다. 콜드스타트(행 없음)에서 값이 그대로면
          // GET이 어차피 COLD_START_LEVEL을 채우므로 행을 만들 필요도 없다.
          if (next === storedLevel(subtest)) continue;
          await manager.upsert(
            SkillLevel,
            {
              patientId: effectivePatientId,
              subtest,
              level: next,
              updatedAt: new Date(),
            },
            ['patientId', 'subtest'],
          );
        }
      }

      // 완료 마커: 자연 종료·피로 탈출 등 세션이 의도한 대로 끝났을 때만 프론트가
      // completed=true를 보낸다. 점진 제출의 중간 flush·화면 이탈 시 best-effort
      // flush는 completed를 안 보내 이탈로 남는다(완료 vs 중단 구분).
      //
      // 완료 시각은 **세션에서 마지막으로 푼 시각**이다(OV-C). 제출이 도착한
      // 시각이 아니다 — 늦게 재전송된 완료 제출의 도착일을 찍으면 완료율 창
      // (completed_at)이 그 세션을 다른 날로 센다.
      //
      // 이번 배치는 바로 위에서 같은 트랜잭션으로 넣었으므로 이 MAX 하나가
      // (이번 배치 ∪ 이미 저장된 행)을 함께 본다. 빈 tail 완료 제출 — 흔한 정상
      // 경로다 — 도 저장된 행에서 시각을 얻는다. 행이 없을 때만 서버 시각이다.
      if (dto.completed) {
        const last = await manager
          .createQueryBuilder(QabResult, 'r')
          .select('MAX(r.answered_at)', 'lastAnsweredAt')
          .where('r.session_token = :token', { token: dto.sessionToken })
          .andWhere('r.patient_id = :pid', { pid: effectivePatientId })
          .getRawOne<{ lastAnsweredAt: Date | null }>();
        await manager.upsert(
          QabSessionCompletion,
          {
            sessionToken: dto.sessionToken,
            patientId: effectivePatientId,
            completedAt: last?.lastAnsweredAt ?? new Date(),
          },
          ['sessionToken'],
        );
      }
    });

    return { saved: rows.length };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 여기서부터 getQabSummary까지: **읽기 전용 집계** — 분리할 때의 이음선
  // ══════════════════════════════════════════════════════════════════════
  //
  // 이 클래스는 리포지토리 9개를 주입받고 1600줄이 넘는다. 서로 다른 일 넷을
  // 한다 — LLM 퀴즈 생성, 채점, 적응 레벨링, 보호자 집계. 테이블 9개가 필요한
  // 서비스는 하나의 일을 하고 있지 않다는 뜻이고, 새 기능마다 여기가 기본
  // 착지점이 돼 왔다(2026-08-16에만 1513→1653줄).
  //
  // 아래 6개 메서드가 가장 깨끗한 이음선이다:
  //
  //     getSkillLevels · getActivityDays · getRecentItems
  //     getSessionStats · getQabTrend    · getQabSummary
  //
  //   - 전부 읽기 전용이다. 쓰기 경로(submitAttempts·saveQabResults)와 트랜잭션을
  //     공유하지 않으므로 떼어낼 때 정합성 문제가 없다.
  //   - 쓰는 테이블이 좁다: qab_results · skill_levels · qab_session_completions
  //     · quiz_attempts. 나머지 5개 리포지토리는 안 쓴다.
  //   - 각자 이미 테스트가 붙어 있어 옮겨도 안전망이 따라간다.
  //
  // 지금 쪼개지 않는 이유는 방금 QA를 통과한 코드이기 때문이다(2026-08-17 리뷰 D3).
  // **다음에 이 영역에 기능을 더할 때** QabReportService로 들어내는 것이 맞다.
  // 그때 옮길 것: 위 6개 + 그들만 쓰는 private 헬퍼 + 대응 스펙 블록.
  //
  // 이 주석을 지우려면 분리를 끝냈거나, 이음선이 더 이상 유효하지 않다고
  // 판단했을 때다. 후자라면 왜인지 여기에 남겨라.

  /**
   * 환자의 스킬별 현재 레벨. 이력이 없는 스킬은 콜드스타트 레벨(2)로 채운다.
   * 프론트가 이 값을 읽어 문항 선택 난이도를 정한다. 레벨은 환자에게 노출하지
   * 않으며(강등 비가시), 선택 로직·보호자 대시보드만 사용한다.
   */
  async getSkillLevels(effectivePatientId: string): Promise<SkillLevelsResult> {
    const rows = await this.skillLevelRepository.find({
      where: { patientId: effectivePatientId },
    });
    const bySubtest = new Map(rows.map((r) => [r.subtest, r.level]));
    const levels = {} as Record<QabSubtest, number>;
    for (const subtest of QAB_SUBTESTS) {
      levels[subtest] = bySubtest.get(subtest) ?? COLD_START_LEVEL;
    }
    return { levels, manifestVersion: QAB_MANIFEST_VERSION };
  }

  /**
   * 환자가 연습을 완료한 날짜 목록(최근 days일, YYYY-MM-DD). 솔로 홈의 스트릭에
   * 쓴다. 세션 하나라도 qab_results가 남으면 그 날을 "완료"로 본다.
   *
   * 날짜 경계는 환자 타임존 기준(getQabTrend의 주차 집계와 같은 헬퍼).
   *
   * **시간 축은 `answered_at`(푼 시각)이다 — 이 파일의 `qab_results` 집계 전부.**
   * `created_at`은 서버가 받은 시각이라, 늦게 재전송된 결과를 도착한 날로 센다
   * (월요일에 푼 것이 수요일 스트릭이 된다). 기존 행은 M28이 `created_at`으로
   * 소급해 결과가 전과 같다. 새 쿼리를 붙일 때도 이 컬럼을 쓸 것 — 스펙의
   * "시간 축" 가드가 이 파일에서 받은 시각 컬럼을 찾으면 깬다.
   */
  async getActivityDays(
    effectivePatientId: string,
    days = 14,
  ): Promise<string[]> {
    const { timezone } = await this.timeAxisOf(effectivePatientId);
    const bucket = dayBucket('r.answered_at', timezone);
    const raw = await this.qabResultRepository
      .createQueryBuilder('r')
      .select(`to_char(${bucket}, 'YYYY-MM-DD')`, 'day')
      .distinct(true)
      .where('r.patient_id = :pid', { pid: effectivePatientId })
      .andWhere(`r.answered_at >= ${dayWindowStart(timezone, days)}`)
      .orderBy('day', 'DESC')
      .getRawMany<{ day: string }>();
    return raw.map((x) => x.day);
  }

  /**
   * 최근 N일 동안 이 검사에서 낸 문항별 최근 성적 (문항 재출제용).
   *
   * 실어증 치료 이득은 **훈련한 그 항목**을 크게 넘어가지 않는다(limited
   * transfer). 그래서 같은 목표가 여러 세션에 반복돼야 의미가 있는데, 프론트가
   * 무작위로 뽑으면 70개 풀에서 재등장이 평균 70세션이라 사실상 반복이 없다.
   * 이 조회로 "최근에 틀린 것부터" 다시 낼 수 있게 한다.
   *
   * 문항당 **가장 최근 1건**만 준다 — 같은 문항을 여러 번 푼 이력을 전부 내려
   * 보내면 프론트가 다시 집계해야 한다. 정렬은 (틀린 것 우선, 오래된 것 우선)
   * 이라 앞에서부터 쓰면 그대로 우선순위가 된다.
   */
  async getRecentItems(
    effectivePatientId: string,
    subtest: QabSubtest,
    days = 30,
    limit = 50,
  ): Promise<RecentItemResult[]> {
    const raw = await this.qabResultRepository
      .createQueryBuilder('r')
      .select('r.item_ref', 'itemRef')
      // **최신 시도의 정오답**이다. `bool_or`(= 한 번이라도 맞았나)를 쓰면 3주 전에
      // 한 번 맞히고 어제 틀린 문항이 "맞힌 것"으로 분류돼, 아래 정렬에서 맨 뒤로
      // 밀린다 — 방금 틀린 낱말이 우선순위 꼴찌가 된다. 반복 훈련의 목적이 바로
      // 그 낱말을 다시 내는 것이라, 정확히 거꾸로 동작했다.
      // 동시각 타이는 id DESC로 결정론(recomputeSkillLevel의 윈도우와 같은 규칙).
      .addSelect(
        '(array_agg(r.is_correct ORDER BY r.answered_at DESC, r.id DESC))[1]',
        'lastCorrect',
      )
      .addSelect('max(r.answered_at)', 'lastAt')
      .where('r.patient_id = :pid', { pid: effectivePatientId })
      .andWhere('r.subtest = :subtest', { subtest })
      // 보호자가 넘어가기로 통과시킨 건 실력 근거가 아니라 재출제 판단에서 뺀다.
      .andWhere('r.assisted = false')
      // 채점 불가도 뺀다. is_correct가 false로 들어 있어 그대로 두면 "방금 틀린
      // 문항"으로 잡혀 재출제 1순위가 된다 — 실제로는 못 잰 것뿐이다.
      .andWhere('r.unscored = false')
      .andWhere('r.answered_at >= now() - make_interval(days => :days)', {
        days,
      })
      .groupBy('r.item_ref')
      // 1순위: 최근에 틀린 문항(false < true). 2순위: 마지막 출제가 오래된 것 —
      // 여기서 간격이 생긴다. 프론트는 이 순서를 재정렬 없이 우선순위로 쓴다.
      .orderBy('"lastCorrect"', 'ASC')
      .addOrderBy('max(r.answered_at)', 'ASC')
      .limit(Math.max(1, Math.min(200, limit)))
      .getRawMany<{ itemRef: string; lastCorrect: boolean; lastAt: Date }>();

    return raw.map((x) => ({
      itemRef: x.itemRef,
      lastCorrect: x.lastCorrect,
      lastAt: x.lastAt.toISOString(),
    }));
  }

  /**
   * 세션 완료율 (보호자용). "며칠째 하고 있나"(스트릭)와 달리 "시작한 걸 끝까지
   * 하고 있나"를 본다 — 중도 이탈이 잦으면 세션이 길거나 어렵다는 신호다.
   * 완료 마커(qab_session_completions)가 없는 세션이 곧 이탈이다.
   *
   * **분모는 QAB만으로 세면 안 된다.** 예전엔 `qab_results`의 세션 토큰만 셌는데,
   * 한 세션은 데일리 문항과 QAB 문항을 섞어 진행하고 QAB 슬롯이 0인 구성도 있다.
   * 그런 세션은 시작한 적조차 없는 것으로 집계돼, 완료율의 분모가 조용히 작아졌다.
   *
   *     started   = qab_results ∪ quiz_attempts 의 세션 토큰   (뭐라도 푼 세션)
   *     completed = 그중 완료 마커가 있는 것
   *
   * 세션 수가 (환자 1명 × 최근 N일이라) 수십 개 규모라 합집합은 앱에서 만든다.
   * SQL UNION 서브쿼리보다 읽기 쉽고, 이탈 세션의 문항 수도 같은 행에서 얻는다.
   *
   * 이탈 평균만은 **QAB 문항이 있던 세션**으로 한정한다. 데일리만 푼 세션은
   * QAB 문항 수가 0이라, 섞어 세면 "0문항 풀고 이탈"이 평균을 끌어내려 지표의
   * 의미가 바뀐다(그 세션은 QAB를 안 한 게 아니라 애초에 없었다).
   */
  async getSessionStats(
    effectivePatientId: string,
    days = 30,
  ): Promise<SessionStatsResult> {
    const pid = effectivePatientId;

    // ① QAB 문항이 있던 세션 — 토큰 + 그 세션에서 푼 문항 수
    const qabRows = await this.qabResultRepository
      .createQueryBuilder('r')
      .select('r.session_token', 'token')
      .addSelect('COUNT(*)', 'items')
      .where('r.patient_id = :pid', { pid })
      .andWhere('r.answered_at >= now() - make_interval(days => :days)', {
        days,
      })
      .groupBy('r.session_token')
      .getRawMany<{ token: string; items: string }>();

    // ② 데일리 문항만 푼 세션 — 이게 빠져 있어서 분모가 샜다
    const attemptRows = await this.quizAttemptRepository
      .createQueryBuilder('a')
      .select('DISTINCT a.session_token', 'token')
      .where('a.patient_id = :pid', { pid })
      .andWhere('a.answered_at >= now() - make_interval(days => :days)', {
        days,
      })
      .getRawMany<{ token: string }>();

    // ③ 완료 마커
    const completionRows = await this.qabSessionCompletionRepository
      .createQueryBuilder('c')
      .select('c.session_token', 'token')
      .where('c.patient_id = :pid', { pid })
      .andWhere('c.completed_at >= now() - make_interval(days => :days)', {
        days,
      })
      .getRawMany<{ token: string }>();

    const startedTokens = new Set<string>([
      ...qabRows.map((r) => r.token),
      ...attemptRows.map((r) => r.token),
    ]);
    const completedTokens = new Set(completionRows.map((r) => r.token));
    // 마커가 창 밖 세션을 가리킬 수 있으므로 시작 집합과 교집합을 낸다 —
    // 안 그러면 완료율이 100%를 넘는다.
    const completed = [...completedTokens].filter((t) =>
      startedTokens.has(t),
    ).length;

    const dropped = qabRows.filter((r) => !completedTokens.has(r.token));
    const totalItems = dropped.reduce((sum, r) => sum + Number(r.items), 0);

    return {
      started: startedTokens.size,
      completed,
      completionRate:
        startedTokens.size > 0
          ? Math.round((completed / startedTokens.size) * 100)
          : null,
      avgItemsBeforeDropoff:
        dropped.length > 0
          ? Math.round((totalItems / dropped.length) * 10) / 10
          : null,
    };
  }

  /**
   * 이 환자의 **시간 축** — 집계 버킷을 자르는 기준.
   *
   * 로케일이 아니라 타임존·주 시작 요일이다. 언어가 아니라 집계 축이라
   * 환자·보호자로 나누지 않는다(M27).
   *
   * 행을 못 찾으면 컬럼 기본값과 같은 값으로 떨어진다 — 지금 동작 그대로다.
   */
  private async timeAxisOf(
    patientId: string,
  ): Promise<{ timezone: string; weekStart: number }> {
    const user = await this.userRepository.findOne({
      where: { id: patientId },
      select: { id: true, timezone: true, weekStart: true },
    });
    return {
      timezone: user?.timezone ?? DEFAULT_TIMEZONE,
      weekStart: user?.weekStart ?? DEFAULT_WEEK_START,
    };
  }

  async getQabTrend(
    effectivePatientId: string,
    weeks = 8,
  ): Promise<QabTrendResult> {
    // 버킷 식을 **한 번만** 만들어 select·where·groupBy·orderBy가 모두 그걸
    // 쓴다. 예전엔 같은 식이 네 번 적혀 있어, 셋만 고쳐도 컴파일되고 테스트도
    // 통과하면서 버킷과 창의 기준점이 어긋났다(첫 주·마지막 주가 반쪽).
    const { timezone, weekStart } = await this.timeAxisOf(effectivePatientId);
    const bucket = weekBucket('r.answered_at', timezone, weekStart);
    const raw = await this.qabResultRepository
      .createQueryBuilder('r')
      .select(`to_char(${bucket}, 'YYYY-MM-DD')`, 'weekStart')
      .addSelect('r.subtest', 'subtest')
      // 채점 불가(unscored)는 오답이 아니라 측정 실패다. 분모에서 뺀다 —
      // 넣으면 Azure가 흔들린 날마다 환자가 퇴행한 것처럼 보인다.
      .addSelect(
        'COUNT(*) FILTER (WHERE NOT r.assisted AND NOT r.unscored)',
        'total',
      )
      .addSelect(
        'SUM(CASE WHEN r.is_correct AND NOT r.assisted AND NOT r.unscored THEN 1 ELSE 0 END)',
        'correct',
      )
      .addSelect('AVG(r.score)', 'avgScore')
      .addSelect('AVG(r.metric)', 'avgMetric')
      .where('r.patient_id = :pid', { pid: effectivePatientId })
      // 창의 하한도 **같은 버킷 식**으로 만든다. 예전엔 `now()`를 서버 TZ·
      // 월요일로 잘라 창과 버킷의 기준점이 달랐다.
      .andWhere(
        `r.answered_at >= ${weekWindowStart(timezone, weekStart, weeks - 1)}`,
      )
      .groupBy(bucket)
      .addGroupBy('r.subtest')
      .orderBy(bucket, 'ASC')
      .getRawMany<{
        weekStart: string;
        subtest: string;
        total: string;
        correct: string;
        avgScore: string | null;
        avgMetric: string | null;
      }>();

    const bySubtest = new Map<string, QabWeeklyPoint[]>();
    for (const row of raw) {
      const total = Number(row.total);
      const correct = Number(row.correct);
      const points = bySubtest.get(row.subtest) ?? [];
      points.push({
        weekStart: row.weekStart,
        total,
        correct,
        // 도움만 받은 주는 분모가 0이다. 0으로 나누지 않는다.
        accuracy: total === 0 ? 0 : Math.round((correct / total) * 100),
        avgScore:
          row.avgScore === null ? null : Math.round(Number(row.avgScore)),
        // ddk 감지 횟수. 요약과 같은 소수 1자리로 맞춘다.
        avgMetric:
          row.avgMetric === null
            ? null
            : Math.round(Number(row.avgMetric) * 10) / 10,
      });
      bySubtest.set(row.subtest, points);
    }

    const series: QabTrendSeries[] = [...bySubtest.entries()].map(
      ([subtest, points]) => ({
        subtest,
        points,
        // 마지막 두 주만 비교한다. 중간에 검사를 쉰 주는 행이 없으므로
        // "직전에 검사한 주" 대비가 된다 — 보호자에게는 그게 자연스럽다.
        deltaFromPrevious:
          points.length < 2
            ? null
            : points[points.length - 1].accuracy -
              points[points.length - 2].accuracy,
      }),
    );

    return { series };
  }

  async getQabSummary(effectivePatientId: string): Promise<QabSummaryResult> {
    const raw = await this.qabResultRepository
      .createQueryBuilder('r')
      // total/correct는 두 종류를 제외해 "환자가 혼자 했고, 실제로 잰" 것만
      // 남긴다 — 보호자 도움(assisted)과 채점 불가(unscored). 앞은 수행이
      // 환자 것이 아니고, 뒤는 수행은 있었으나 **측정에 실패**한 것이다.
      // 둘 다 오답이 아니므로 분모에 있으면 정확도를 끌어내린다.
      .select('r.subtest', 'subtest')
      .addSelect(
        'COUNT(*) FILTER (WHERE NOT r.assisted AND NOT r.unscored)',
        'total',
      )
      .addSelect(
        'SUM(CASE WHEN r.is_correct AND NOT r.assisted AND NOT r.unscored THEN 1 ELSE 0 END)',
        'correct',
      )
      .addSelect('SUM(CASE WHEN r.assisted THEN 1 ELSE 0 END)', 'assisted')
      // 세어서 내보낸다. 채점 실패율을 아무도 볼 수 없으면 조용히 망가진다.
      .addSelect('SUM(CASE WHEN r.unscored THEN 1 ELSE 0 END)', 'unscored')
      .addSelect(
        `SUM(CASE WHEN r.unscored AND r.unscored_reason = 'ambiguous' THEN 1 ELSE 0 END)`,
        'unscoredAmbiguous',
      )
      // 채점기 버전 — NULL(컬럼 이전)은 그 시절의 유일한 채점기로 해석한다. 소급해서 채우지
      // 않았으므로 읽을 때 COALESCE로 같은 뜻을 얻는다.
      .addSelect(
        `ARRAY_AGG(DISTINCT COALESCE(r.scorer_version, '${QAB_LEGACY_SCORER_VERSION}'))`,
        'scorerVersions',
      )
      // 이웃 비교를 거친 시도와 그중 다시 말하게 한 것 — NULL(거치지 않음)과 0(안 다시 시킴)을 가른다.
      .addSelect(
        'COUNT(*) FILTER (WHERE r.ambiguous_retries IS NOT NULL)',
        'neighborAttempts',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE r.ambiguous_retries >= 1)',
        'neighborRetried',
      )
      .addSelect(
        `MIN(r.answered_at) FILTER (WHERE COALESCE(r.scorer_version, '${QAB_LEGACY_SCORER_VERSION}') <> '${QAB_LEGACY_SCORER_VERSION}')`,
        'scorerChangedAt',
      )
      .addSelect('AVG(r.metric)', 'avgMetric')
      .addSelect('MAX(r.metric)', 'maxMetric')
      .addSelect('AVG(r.score)', 'avgScore')
      .addSelect('MAX(r.answered_at)', 'lastAt')
      // 오답 갈래 — total/correct와 같은 기준(도움받은 문항 제외)으로 센다.
      // foil_kind는 오답에만 값이 있으므로 is_correct 조건은 불필요하다.
      .addSelect(
        `COUNT(*) FILTER (WHERE NOT r.assisted AND r.foil_kind = 'semantic')`,
        'foilSemantic',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE NOT r.assisted AND r.foil_kind = 'phonological')`,
        'foilPhonological',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE NOT r.assisted AND r.foil_kind = 'unrelated')`,
        'foilUnrelated',
      )
      // 단서 위계(E18) — 이름대기에서 **얼마나 도와야 했나**.
      //
      // `assisted`로 거르지 않는다. 여기서는 도움받은 문항이 빠질 대상이 아니라
      // **재려는 대상 자체**다. 정답률이 "도움 없이 몇 %"를 말한다면 이 값은
      // "평균 몇 칸을 도왔나"를 말한다.
      //
      // 이 기능 이전의 기록은 cue_level이 NULL이라 AVG가 알아서 뺀다. 0으로
      // 메우면 "예전엔 단서 없이 다 맞혔다"는 거짓 회복 곡선이 그려진다.
      .addSelect('AVG(r.cue_level)', 'avgCueLevel')
      .addSelect('COUNT(*) FILTER (WHERE r.cue_level IS NOT NULL)', 'cueScored')
      .where('r.patient_id = :pid', { pid: effectivePatientId })
      .groupBy('r.subtest')
      .getRawMany<{
        subtest: string;
        total: string;
        correct: string;
        assisted: string;
        unscored: string;
        unscoredAmbiguous: string;
        neighborAttempts: string;
        neighborRetried: string;
        scorerVersions: string[] | null;
        scorerChangedAt: Date | string | null;
        avgMetric: string | null;
        maxMetric: string | null;
        avgScore: string | null;
        lastAt: Date | string | null;
        foilSemantic: string;
        foilPhonological: string;
        foilUnrelated: string;
        avgCueLevel: string | null;
        cueScored: string;
      }>();

    const items: QabSubtestSummary[] = raw.map((row) => {
      const total = Number(row.total);
      const correct = Number(row.correct);
      const assisted = Number(row.assisted);
      const unscored = Number(row.unscored);
      // `?? 0` — 실 DB는 항상 컬럼을 주지만 없으면 Number(undefined)가 NaN이 되어 API로 샌다.
      const unscoredAmbiguous = Number(row.unscoredAmbiguous ?? 0);
      const neighborAttempts = Number(row.neighborAttempts ?? 0);
      const neighborRetried = Number(row.neighborRetried ?? 0);
      const scorerVersions = [...(row.scorerVersions ?? [])].sort();
      const scorerChangedAt =
        row.scorerChangedAt === null || row.scorerChangedAt === undefined
          ? null
          : row.scorerChangedAt instanceof Date
            ? row.scorerChangedAt.toISOString()
            : new Date(row.scorerChangedAt).toISOString();
      const avgMetric =
        row.avgMetric === null
          ? null
          : Math.round(Number(row.avgMetric) * 10) / 10;
      const maxMetric = row.maxMetric === null ? null : Number(row.maxMetric);
      const avgScore =
        row.avgScore === null ? null : Math.round(Number(row.avgScore));
      const lastAt =
        row.lastAt === null
          ? null
          : row.lastAt instanceof Date
            ? row.lastAt.toISOString()
            : new Date(row.lastAt).toISOString();
      const semantic = Number(row.foilSemantic);
      const phonological = Number(row.foilPhonological);
      const unrelated = Number(row.foilUnrelated);
      // 셋 다 0이면 null. 0으로 채운 값을 내려보내면 화면이 "관계없는 그림 0개"
      // 같은 없는 사실을 그린다.
      const foilKinds =
        semantic + phonological + unrelated > 0
          ? { semantic, phonological, unrelated }
          : null;
      // 표본이 없으면 null이다. 0으로 내려보내면 화면이 "평균 0단계"(= 늘
      // 무단서로 맞혔다)라는 없는 사실을 그린다 — foilKinds와 같은 이유다.
      // `?? 0` — 실 DB는 항상 컬럼을 주지만, 없으면 Number(undefined)가 NaN이
      // 되어 그대로 API로 샌다. NaN은 JSON에서 null이 되므로 조용히 틀린다.
      const cueScored = Number(row.cueScored ?? 0);
      const avgCueLevel =
        cueScored === 0 || row.avgCueLevel === null
          ? null
          : Math.round(Number(row.avgCueLevel) * 10) / 10;
      return {
        subtest: row.subtest,
        total,
        correct,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
        assisted,
        unscored,
        unscoredAmbiguous,
        neighborAttempts,
        neighborRetried,
        scorerVersions,
        scorerChangedAt,
        avgMetric,
        maxMetric,
        avgScore,
        lastAt,
        foilKinds,
        avgCueLevel,
        cueScored,
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
  // ══════════════════════════════════════════════════════════════════════
  // 읽기 전용 집계 끝 — 아래는 다시 쓰기·생성 경로다
  // ══════════════════════════════════════════════════════════════════════

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
    let skipped = 0;
    for (const set of stale) {
      // 원자적 claim: 이 set을 나만 처리하도록 잠근다. 여러 워커가 동시에 부팅하거나
      // 크래시루프로 겹쳐 돌면, claim 없이는 같은 set을 중복 생성해 문항이 쌓인다.
      // 조건부 UPDATE(status·attempts가 방금 읽은 값 그대로일 때만)로 attempts를
      // 올리며, affected===1인 워커만 소유권을 얻는다.
      const claimed = await this.claimSetForRecovery(set);
      if (!claimed) {
        skipped += 1;
        continue;
      }

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
      `막힌 QuizSet 복구 완료 (recovered=${recovered}, failed=${failed}, ` +
        `skipped=${skipped}, scanned=${stale.length})`,
    );
    return { recovered, failed, skipped };
  }

  /**
   * 복구 대상 set을 원자적으로 claim한다.
   *
   * 방금 find로 읽은 status·attempts가 그대로일 때만 attempts를 1 올린다.
   * 다른 워커가 먼저 claim하면 attempts가 바뀌어 조건 불일치 → affected 0 → false.
   * 이 조건부 UPDATE가 claim(소유권)과 시도 카운트를 한 번에 원자적으로 처리한다.
   */
  private async claimSetForRecovery(set: QuizSet): Promise<boolean> {
    const result = await this.quizSetRepository.update(
      {
        id: set.id,
        generationStatus: set.generationStatus,
        generationAttempts: set.generationAttempts,
      },
      { generationAttempts: () => '"generation_attempts" + 1' },
    );
    return result.affected === 1;
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
