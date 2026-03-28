/**
 * LOC 검사 애플리케이션 계층 에러
 *
 * 유스케이스 실행 중 발생하는 에러를 코드화하여 표현한다.
 * 프레젠테이션 계층에서 에러 코드를 기반으로 사용자 메시지를 매핑한다.
 */

export const LocAssessmentErrorCode = {
  TTS_PLAYBACK_FAILED: 'LOC_TTS_PLAYBACK_FAILED',
  STORAGE_FAILED: 'LOC_STORAGE_FAILED',
  INVALID_TRIAL_NUMBER: 'LOC_INVALID_TRIAL_NUMBER',
  ASSESSMENT_ALREADY_COMPLETE: 'LOC_ASSESSMENT_ALREADY_COMPLETE',
} as const;

export type LocAssessmentErrorCode =
  (typeof LocAssessmentErrorCode)[keyof typeof LocAssessmentErrorCode];

export class LocAssessmentError extends Error {
  readonly code: LocAssessmentErrorCode;
  readonly cause: unknown;

  constructor(
    code: LocAssessmentErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'LocAssessmentError';
    this.code = code;
    this.cause = cause;
  }
}
