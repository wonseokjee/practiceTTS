// 데일리 퀴즈 도메인 타입
//
// 백엔드 Phase 3 API 계약(GET /quiz/sets, GET /quiz/sets/:id,
// POST /quiz/sets/:id/attempts, GET /quiz/sets/:id/best-score)을 그대로 미러링한다.
// 정답(correctAnswer)은 상세 조회 응답에 포함되지 않으며, 제출 응답에서만 노출된다.

/** 퀴즈 세트 생성 상태 */
export type QuizGenerationStatus = 'pending' | 'ready' | 'failed';

/**
 * 문제 유형
 * - multiple_choice: 4지선다
 * - yes_no: 예/아니오
 * - fill_blank: 빈칸 채우기(타이핑) — 현재 세트 구성에선 미사용(말하기로 대체)
 * - speech: 음성으로 말하기 (STT 인식 텍스트 제출)
 *
 * `tile_arrange`(글자 타일 조합)는 여기 없다 — 기억 기반 생성이 끊기고
 * (#44) 저장된 행도 `speech`로 소급 전환된 뒤(M26, #48 2단계) 은퇴했다
 * (#48 3단계). 같은 조합 메커니즘은 `TileArrangeInput` 컴포넌트로 남아
 * QAB `spell` 검사(그림 단서 + 레벨 연동)가 계속 쓴다 — 지운 것은 이
 * "정답을 서버만 아는 데일리 문항" 유형이지, 타일 UI 자체가 아니다.
 */
export type QuizQuestionType =
  | 'multiple_choice'
  | 'yes_no'
  | 'fill_blank'
  | 'speech';

/** 환자 답변 카테고리 (상세 조회 시 노출용 메모) */
export type PatientNoteCategory = 'activity' | 'moment' | 'context';

/**
 * GET /quiz/sets 목록 항목.
 * 목록 화면은 generationStatus === 'ready'만 노출하는 것을 권장한다.
 */
export interface QuizSetSummary {
  quizSetId: string;
  memoryEntryId: string;
  photoUrl: string | null;
  generationStatus: QuizGenerationStatus;
  bestScore: number | null;
  createdAt: string;
}

/**
 * 돌아보기 화면의 카드 하나 — 최근에 **실제로 푼** 기억.
 *
 * 점수가 없다. 환자 화면은 정답률을 보여주지 않는 것이 이 앱의 원칙이고,
 * 돌아보기의 목적은 평가가 아니라 회상이다.
 *
 * `photoUrl`이 없으면 `notes`가 카드를 채운다. 기억은 사진 아니면 글 중 하나가
 * 반드시 있으므로(백엔드가 생성 시점에 강제) 빈 카드는 나오지 않는다.
 */
export interface WeekReviewNote {
  /** `moment`가 그 순간의 기억이고, 나머지 둘은 한두 낱말짜리 태그다. */
  category: 'activity' | 'moment' | 'context';
  text: string;
}

export interface WeekReviewItem {
  quizSetId: string;
  memoryEntryId: string;
  photoUrl: string | null;
  notes: WeekReviewNote[];
  lastPlayedAt: string;
}

/** 상세 조회에 포함되는 환자 메모 */
export interface PatientNote {
  category: PatientNoteCategory;
  answerText: string;
}

/**
 * 상세 조회에 포함되는 공개 문제(정답 미포함).
 * - multiple_choice: choices에 보기 4개, hintFirstChar = null
 * - yes_no:          choices = null, hintFirstChar = null
 * - fill_blank:      choices = null, hintFirstChar = 첫 글자 힌트(있을 수 있음)
 * - speech:          따라읽기. choices = null, targetWord = 읽을 단어(노출), prompt = 안내 문구
 */
export interface QuizQuestionPublic {
  id: string;
  orderIndex: number;
  type: QuizQuestionType;
  prompt: string;
  choices: string[] | null;
  /** speech 따라읽기에서 보여주고 발음할 단어 (speech일 때만 non-null) */
  targetWord: string | null;
  hintFirstChar: string | null;
}

/** GET /quiz/sets/:id 상세 응답 */
export interface QuizSetDetail {
  quizSetId: string;
  memoryEntry: {
    photoUrl: string | null;
    /** Phase 5 시점엔 항상 null (Phase 6에서 도입) */
    caregiverWishMessage: string | null;
  };
  patientNotes: PatientNote[];
  questions: QuizQuestionPublic[];
}

/** POST attempts 응답의 개별 문제 채점 결과 */
export interface AttemptResult {
  questionId: string;
  isCorrect: boolean;
  correctAnswer: string;
}

/** POST /quiz/sets/:id/attempts 응답 */
export interface SubmitAttemptsResult {
  results: AttemptResult[];
  /** 이번 세션 점수 (0..100) */
  sessionScore: number;
  /** 세트의 모든 문제를 풀었는지 여부 */
  completed: boolean;
  /** 완료 시점에만 동반 — 역대 최고점 */
  bestScore?: number;
  /** 완료 시점에만 동반 — 이번 시도가 신기록인지 */
  isNewBest?: boolean;
}

/** GET /quiz/sets/:id/best-score 응답 */
export interface BestScore {
  quizSetId: string;
  bestScore: number | null;
  achievedAt?: string;
}

/**
 * 한마디→발화연습 변환 결과 (Phase 6 Pattern 1).
 * POST /quiz/sets/:id/wish-practice 응답 미러.
 */
export interface WishFillBlank {
  prompt: string;
  answer: string;
  hintFirstChar: string;
}

export interface WishPractice {
  /** 따라말하기용 문장 (한마디 원문) */
  echoSentence: string;
  /** 빈칸 채우기 문항 */
  fillBlank: WishFillBlank;
  model: string;
  fallbackUsed: boolean;
}

/** 제출 답안 1건 (questionId + 사용자 답) */
export interface SubmitAnswer {
  questionId: string;
  /**
   * 사용자 답.
   * - multiple_choice: 선택한 보기 문자열
   * - yes_no:          'yes' | 'no'
   * - fill_blank:      입력 텍스트
   * - speech:          STT 인식 텍스트
   */
  userAnswer: string;
}

/** yes_no 문제에 허용되는 답안 값 */
export const YES_NO_ANSWERS = {
  YES: 'yes',
  NO: 'no',
} as const;

export type YesNoAnswer = (typeof YES_NO_ANSWERS)[keyof typeof YES_NO_ANSWERS];

/** 한 세트의 총 문제 수 (백엔드 고정값) */
export const QUIZ_QUESTIONS_PER_SET = 5;
