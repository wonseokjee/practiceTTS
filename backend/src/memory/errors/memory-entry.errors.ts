// 메모리 엔트리 도메인 에러 코드 및 에러 클래스

/** 메모리 엔트리 관련 에러 코드 열거형 */
export enum MemoryEntryErrorCode {
  NOT_FOUND = 'MEMORY_ENTRY_NOT_FOUND',
  FORBIDDEN = 'MEMORY_ENTRY_FORBIDDEN',
  INVALID_EMOTION_TAG = 'INVALID_EMOTION_TAG',
  TARGET_WORDS_LIMIT_EXCEEDED = 'TARGET_WORDS_LIMIT_EXCEEDED',
  PHOTO_REQUIRED = 'PHOTO_REQUIRED',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_SIZE_EXCEEDED = 'FILE_SIZE_EXCEEDED',
  MASKING_NOT_COMPLETE = 'MASKING_NOT_COMPLETE',
  TARGET_WORDS_REQUIRED = 'TARGET_WORDS_REQUIRED',
  AI_SERVICE_UNAVAILABLE = 'AI_SERVICE_UNAVAILABLE',
}

/** 메모리 엔트리 도메인 에러 기반 클래스 */
export class MemoryEntryError extends Error {
  constructor(
    public readonly code: MemoryEntryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MemoryEntryError';
  }
}
