/**
 * 인증 도메인 상수
 *
 * 보호자 단일 계정 모델(20260531_SingleCaregiverAccount_feature_plan):
 * - 환자는 로그인 없는 users 행으로 보호자 회원가입 시 생성된다.
 * - placeholder email은 UNIQUE 제약만 만족하면 되며 사용자에게 노출되지 않는다.
 * - passwordHash는 bcrypt가 절대 매칭할 수 없는 sentinel을 저장하고,
 *   login()은 이 계정을 bcrypt 비교 전에 명시적으로 거부한다.
 */

/** 환자 placeholder email 도메인 — 실 도메인 아님(로그인/표시 미사용) */
export const PATIENT_PLACEHOLDER_EMAIL_DOMAIN = 'local.invalid';

/** 로그인 불가 표식(sentinel). 정상 bcrypt 해시(60자)가 아니므로 명백히 비교 불가. */
export const UNUSABLE_PASSWORD_HASH = '!';

/** 환자 placeholder email 생성 (UNIQUE 충돌 회피) */
export function buildPatientPlaceholderEmail(patientUserId: string): string {
  return `patient+${patientUserId}@${PATIENT_PLACEHOLDER_EMAIL_DOMAIN}`;
}

/**
 * 환자 모드 복귀 PIN — 연속 실패 시 점증 대기(잠금 없음).
 * 인덱스 = 실패 횟수(0-based 직전 실패 수), 값 = 다음 시도까지 대기(ms).
 * 1~2회: 즉시, 3회 후 5초, 4회 후 15초, 5회+ 30초.
 */
export const PATIENT_MODE_PIN_RETRY_DELAYS_MS: readonly number[] = [
  0, 0, 5_000, 15_000, 30_000,
];

/** 5회 이상 실패 시 적용할 최대 대기(ms) */
export const PATIENT_MODE_PIN_MAX_DELAY_MS = 30_000;

/** PIN 형식: 4자리 숫자 */
export const PATIENT_MODE_PIN_REGEX = /^[0-9]{4}$/;
