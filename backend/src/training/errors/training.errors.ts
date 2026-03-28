/** 훈련 세션 도메인 에러 코드 열거형 */
export enum TrainingErrorCode {
  SESSION_NOT_FOUND = 'TRAINING_SESSION_NOT_FOUND',
  SESSION_FORBIDDEN = 'TRAINING_SESSION_FORBIDDEN',
  SESSION_NOT_ACTIVE = 'TRAINING_SESSION_NOT_ACTIVE',
  MEMORY_ENTRY_NOT_FOUND = 'TRAINING_MEMORY_ENTRY_NOT_FOUND',
  SCENARIO_NOT_READY = 'TRAINING_SCENARIO_NOT_READY',
  AI_SERVICE_UNAVAILABLE = 'TRAINING_AI_SERVICE_UNAVAILABLE',
  ENCRYPT_FAILED = 'TRAINING_ENCRYPT_FAILED',
  DECRYPT_FAILED = 'TRAINING_DECRYPT_FAILED',
}

/** 훈련 세션 도메인 에러 클래스 */
export class TrainingError extends Error {
  constructor(
    public readonly code: TrainingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TrainingError';
  }
}
