// 퀴즈 도메인 에러 코드 및 에러 클래스 (memory-entry.errors.ts 패턴 준수)

/** 퀴즈 관련 에러 코드 열거형 */
export enum QuizErrorCode {
  MEMORY_ENTRY_NOT_FOUND = 'QUIZ_MEMORY_ENTRY_NOT_FOUND',
  NOT_OWNER = 'NOT_OWNER_OF_MEMORY_ENTRY',
  QUIZ_SET_ALREADY_EXISTS = 'QUIZ_SET_ALREADY_EXISTS',
  QUIZ_SET_NOT_FOUND = 'QUIZ_SET_NOT_FOUND',
  QUIZ_NOT_READY = 'QUIZ_NOT_READY',
  FORBIDDEN = 'QUIZ_FORBIDDEN',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  INVALID_ANSWER_FORMAT = 'INVALID_ANSWER_FORMAT',
  NO_PATIENT_NOTES = 'NO_PATIENT_NOTES',
  /** LLM 호출 실패 (원인 미상/네트워크) — 일시적, 재시도 가능 */
  LLM_GENERATION_FAILED = 'LLM_GENERATION_FAILED',
  /** FastAPI 422 — 메모가 퀴즈 생성에 부적합 (영구, 재시도해도 동일) */
  LLM_INVALID_NOTES = 'LLM_INVALID_NOTES',
  /** FastAPI 504 — LLM 응답 지연 (일시적, 재시도 가능) */
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  /** FastAPI 502 — LLM 업스트림 오류 (일시적, 재시도 가능) */
  LLM_UPSTREAM = 'LLM_UPSTREAM',
  /** 양방향 치유 v1 — 해당 라이프로그에 보호자 한마디가 없음 */
  NO_WISH_MESSAGE = 'NO_WISH_MESSAGE',
}

/**
 * 생성 실패가 영구적(재시도 무의미)인지 판별한다.
 * - 영구: LLM_INVALID_NOTES (메모 자체가 부적합 → 재생성해도 동일)
 * - 일시: 그 외 LLM 실패 (네트워크/타임아웃/업스트림 → 재시도 가치 있음)
 */
export function isPermanentGenerationFailure(code: QuizErrorCode): boolean {
  return code === QuizErrorCode.LLM_INVALID_NOTES;
}

/** 퀴즈 도메인 에러 기반 클래스 */
export class QuizError extends Error {
  constructor(
    public readonly code: QuizErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuizError';
  }
}
