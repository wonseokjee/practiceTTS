/**
 * 단어 이해 (WordComp) 검사 - 애플리케이션 계층 에러
 *
 * UseCase 실행 중 발생하는 에러를 코드화하여 표현한다.
 * Presentation 계층에서 에러 코드를 기반으로 사용자 메시지를 매핑한다.
 */

export const WcAppErrorCode = {
  ITEM_LOAD_FAILED: 'WC_APP_ITEM_LOAD_FAILED',
  AUDIO_PLAY_FAILED: 'WC_APP_AUDIO_PLAY_FAILED',
  SESSION_NOT_FOUND: 'WC_SESSION_NOT_FOUND',
  INVALID_CHOICE: 'WC_INVALID_CHOICE',
  ALREADY_ANSWERED: 'WC_ALREADY_ANSWERED',
  INVALID_PATIENT: 'WC_INVALID_PATIENT',
} as const;

export type WcAppErrorCode =
  (typeof WcAppErrorCode)[keyof typeof WcAppErrorCode];

export class WordComprehensionAppError extends Error {
  readonly code: WcAppErrorCode;

  constructor(code: WcAppErrorCode, message: string) {
    super(message);
    this.name = 'WordComprehensionAppError';
    this.code = code;
  }
}
