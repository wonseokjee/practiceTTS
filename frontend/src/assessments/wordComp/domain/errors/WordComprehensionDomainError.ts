/**
 * 단어 이해 (WordComp) 검사 - 도메인 계층 에러
 *
 * Domain 레이어에서 불변 조건 위반 시 발생하는 타입화된 에러.
 * Presentation 계층에서 에러 코드를 기반으로 사용자 메시지를 매핑한다.
 */

export const WcDomainErrorCode = {
  INVALID_REACTION_TIME: 'WC_INVALID_REACTION_TIME',
  INVALID_SCORE: 'WC_INVALID_SCORE',
} as const;

export type WcDomainErrorCode =
  (typeof WcDomainErrorCode)[keyof typeof WcDomainErrorCode];

export class WordComprehensionDomainError extends Error {
  readonly code: WcDomainErrorCode;

  constructor(code: WcDomainErrorCode, message: string) {
    super(message);
    this.name = 'WordComprehensionDomainError';
    this.code = code;
  }
}
