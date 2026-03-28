/**
 * 문장 이해 (SentComp) 검사 - 애플리케이션 계층 에러
 *
 * 유스케이스 실행 중 발생하는 에러를 코드화하여 표현한다.
 * Presentation 계층에서 에러 코드를 기반으로 사용자 메시지를 매핑한다.
 *
 * TypeScript erasableSyntaxOnly 제약으로 enum 사용 금지.
 * as const 객체 + 유니온 타입을 사용한다.
 */

export const SentCompErrorCode = {
  ITEM_NOT_FOUND: 'SENT_COMP_ITEM_NOT_FOUND',
  AUDIO_NOT_PLAYED: 'SENT_COMP_AUDIO_NOT_PLAYED',
  AUDIO_LOAD_FAILED: 'SENT_COMP_AUDIO_LOAD_FAILED',
  ITEMS_LOAD_FAILED: 'SENT_COMP_ITEMS_LOAD_FAILED',
  SAVE_FAILED: 'SENT_COMP_SAVE_FAILED',
  DUPLICATE_SUBMISSION: 'SENT_COMP_DUPLICATE_SUBMISSION',
} as const;

export type SentCompErrorCode =
  (typeof SentCompErrorCode)[keyof typeof SentCompErrorCode];

export class SentCompError extends Error {
  readonly code: SentCompErrorCode;
  readonly cause: unknown;

  constructor(code: SentCompErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'SentCompError';
    this.code = code;
    this.cause = cause;
  }
}
