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
  LLM_GENERATION_FAILED = 'LLM_GENERATION_FAILED',
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
