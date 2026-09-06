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

/** 프로덕션에서 요구하는 JWT_SECRET 최소 길이. CryptoService.MIN_SECRET_LENGTH와 동일 기준. */
const JWT_SECRET_MIN_LENGTH = 32;

/** 개발 편의용 기본값. 프로덕션에서는 이 값으로 기동조차 못 하게 막는다(아래 참고). */
const JWT_SECRET_DEV_FALLBACK = 'memorylink-secret-key-change-in-prod';

/**
 * JWT 서명/검증 키를 해석한다. JwtModule.registerAsync와 JwtStrategy 양쪽이
 * 이 함수를 통해서만 시크릿을 읽어야 한다 — 예전에는 각자
 * `configService.get('JWT_SECRET', 'memorylink-secret-key-change-in-prod')`를
 * 호출해서, 환경변수가 비면 소스에 박힌 문자열이 조용히 서명 키가 됐다.
 * 그 문자열은 저장소를 읽을 수 있는 누구나 안다 — CRYPTO_SECRET_KEY와 달리
 * 이걸 막는 부팅 검증이 없어서, 임의 user id로 직접 서명한 JWT로 그 사용자를
 * 완전히 사칭할 수 있었다(CVE급 인증 우회).
 *
 * CryptoService와 같은 원칙: 프로덕션에서는 짧거나 없는 시크릿으로 기동 자체를
 * 막는다(throw). 개발에서는 편의상 기존 기본값으로 경고만 남기고 진행한다.
 */
export function resolveJwtSecret(
  configService: Pick<ConfigServiceLike, 'get'>,
): string {
  const secret = configService.get<string>('JWT_SECRET', '');
  const isProduction =
    configService.get<string>('NODE_ENV', '') === 'production';

  if (secret.length >= JWT_SECRET_MIN_LENGTH) {
    return secret;
  }

  const message =
    `JWT_SECRET이 ${JWT_SECRET_MIN_LENGTH}자 미만입니다(현재 ${secret.length}자). ` +
    '이 값은 모든 사용자 세션의 서명 키입니다.';

  if (isProduction) {
    throw new Error(
      `[Auth] ${message} 프로덕션에서는 기동을 중단합니다. ` +
        `생성: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  console.warn(
    `[Auth] ${message} 개발 환경이라 기본값으로 계속 진행하지만, ` +
      '이 키로 발급한 토큰은 저장소를 읽은 누구나 위조할 수 있습니다.',
  );
  return JWT_SECRET_DEV_FALLBACK;
}

/** resolveJwtSecret이 요구하는 최소 인터페이스(ConfigService와 구조적으로 호환). */
interface ConfigServiceLike {
  get<T = string>(key: string, defaultValue: T): T;
}
