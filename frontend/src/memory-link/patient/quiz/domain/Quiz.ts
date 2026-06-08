// 데일리 퀴즈 도메인 타입
//
// 백엔드 Phase 3 API 계약(GET /quiz/sets, GET /quiz/sets/:id,
// POST /quiz/sets/:id/attempts, GET /quiz/sets/:id/best-score)을 그대로 미러링한다.
// 정답(correctAnswer)은 상세 조회 응답에 포함되지 않으며, 제출 응답에서만 노출된다.

/** 퀴즈 세트 생성 상태 */
export type QuizGenerationStatus = 'pending' | 'ready' | 'failed';

/** 문제 유형 */
export type QuizQuestionType = 'multiple_choice' | 'yes_no' | 'fill_blank';

/** 환자 답변 카테고리 (상세 조회 시 노출용 메모) */
export type PatientNoteCategory = 'activity' | 'moment' | 'context';

/**
 * GET /quiz/sets 목록 항목.
 * 목록 화면은 generationStatus === 'ready'만 노출하는 것을 권장한다.
 */
export interface QuizSetSummary {
  quizSetId: string;
  memoryEntryId: string;
  notePreview: string;
  photoUrl: string | null;
  generationStatus: QuizGenerationStatus;
  bestScore: number | null;
  createdAt: string;
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
 */
export interface QuizQuestionPublic {
  id: string;
  orderIndex: number;
  type: QuizQuestionType;
  prompt: string;
  choices: string[] | null;
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
