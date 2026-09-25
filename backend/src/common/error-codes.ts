/**
 * 서버 오류 코드 계약(영어판 실행 계획 §17 D2).
 *
 * 서버는 `{ code, message }`를 내려준다. `message`는 한국어 폴백(구버전 클라이언트·로그용)이고,
 * 화면 문구는 클라이언트가 `code`로 i18n에서 로케일에 맞게 고른다
 * (`common.json` `errors.server.<code>`). 새 코드는 ko/en 양쪽 문구를 함께 넣는다 —
 * `errorCodes.test`가 백엔드 상수와 프런트 키의 짝을 강제한다.
 */
export const AUTH_ERRORS = {
  EMAIL_TAKEN: {
    code: 'AUTH_EMAIL_TAKEN',
    message: '이미 사용 중인 이메일입니다.',
  },
  INVALID_CREDENTIALS: {
    code: 'AUTH_INVALID_CREDENTIALS',
    message: '이메일 또는 비밀번호가 올바르지 않습니다.',
  },
  INVALID_TOKEN: {
    code: 'AUTH_INVALID_TOKEN',
    message: '유효하지 않은 인증 토큰입니다.',
  },
  USER_NOT_FOUND: {
    code: 'AUTH_USER_NOT_FOUND',
    message: '사용자를 찾을 수 없습니다.',
  },
  PIN_NOT_SET: {
    code: 'AUTH_PIN_NOT_SET',
    message: 'PIN이 설정되어 있지 않습니다.',
  },
  PIN_MISMATCH: {
    code: 'AUTH_PIN_MISMATCH',
    message: 'PIN이 일치하지 않습니다.',
  },
  CODE_EXPIRED_OR_INVALID: {
    code: 'AUTH_CODE_EXPIRED_OR_INVALID',
    message: '만료되었거나 유효하지 않은 코드입니다.',
  },
  ONBOARDING_CAREGIVER_ONLY: {
    code: 'AUTH_ONBOARDING_CAREGIVER_ONLY',
    message: '보호자 계정만 온보딩할 수 있습니다.',
  },
  ONBOARDING_ALREADY_DONE: {
    code: 'AUTH_ONBOARDING_ALREADY_DONE',
    message: '이미 온보딩이 완료되었습니다.',
  },
  SOCIAL_LINKED_ELSEWHERE: {
    code: 'AUTH_SOCIAL_LINKED_ELSEWHERE',
    message: '이미 다른 계정에 연결된 소셜 계정입니다.',
  },
  PROVIDER_ALREADY_LINKED: {
    code: 'AUTH_PROVIDER_ALREADY_LINKED',
    message: '이미 이 제공자가 연결되어 있습니다.',
  },
  SOCIAL_ALREADY_LINKED: {
    code: 'AUTH_SOCIAL_ALREADY_LINKED',
    message: '이미 연결된 소셜 계정입니다.',
  },
  PROVIDER_NOT_LINKED: {
    code: 'AUTH_PROVIDER_NOT_LINKED',
    message: '연결되지 않은 제공자입니다.',
  },
  LAST_LOGIN_METHOD: {
    code: 'AUTH_LAST_LOGIN_METHOD',
    message: '마지막 로그인 수단은 해제할 수 없어요.',
  },
  MERGE_SOURCE_NOT_FOUND: {
    code: 'AUTH_MERGE_SOURCE_NOT_FOUND',
    message: '그 로그인으로 가입된 기존 계정이 없습니다.',
  },
  MERGE_SAME_ACCOUNT: {
    code: 'AUTH_MERGE_SAME_ACCOUNT',
    message: '같은 계정입니다. 기존 계정의 다른 로그인 방법을 선택하세요.',
  },
  CURRENT_USER_NOT_FOUND: {
    code: 'AUTH_CURRENT_USER_NOT_FOUND',
    message: '현재 계정을 찾을 수 없습니다.',
  },
  MERGE_HAS_PATIENT: {
    code: 'AUTH_MERGE_HAS_PATIENT',
    message: '이미 어르신 정보가 등록된 계정은 자동 병합할 수 없습니다.',
  },
  MERGE_PROVIDER_CONFLICT: {
    code: 'AUTH_MERGE_PROVIDER_CONFLICT',
    message: '기존 계정에 이미 같은 종류의 로그인이 있어 합칠 수 없습니다.',
  },
} as const;
