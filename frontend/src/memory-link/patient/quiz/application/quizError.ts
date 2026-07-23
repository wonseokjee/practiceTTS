// 퀴즈 API 에러 → 환자 친화 한국어 메시지 매핑
//
// 백엔드 에러 계약(Plan §1, §10):
//   404 NOT_FOUND, 403 FORBIDDEN, 409 QUIZ_NOT_READY,
//   410 SESSION_EXPIRED, 422 INVALID_ANSWER_FORMAT
// axios에 직접 의존하지 않도록(테스트 용이성) error 객체를 덕타이핑으로 해석한다.

/** 매핑된 에러 정보 */
export interface QuizErrorInfo {
  /** 사용자에게 보여줄 한국어 메시지 */
  message: string;
  /** HTTP 상태코드 (식별 가능 시) */
  status: number | null;
  /** 세션 만료(410) 여부 — 호출측에서 retry 유도에 사용 */
  isSessionExpired: boolean;
  /** 준비 안 됨(409) 여부 */
  isNotReady: boolean;
}

/** error 객체에서 HTTP 상태코드를 안전하게 추출 */
function extractStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const obj = err as Record<string, unknown>;
  const response = obj.response;
  if (typeof response !== 'object' || response === null) return null;
  const status = (response as Record<string, unknown>).status;
  return typeof status === 'number' ? status : null;
}

/** error 객체에서 서버 message를 안전하게 추출 */
function extractServerMessage(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const obj = err as Record<string, unknown>;
  const response = obj.response;
  if (typeof response !== 'object' || response === null) return null;
  const data = (response as Record<string, unknown>).data;
  if (typeof data !== 'object' || data === null) return null;
  const message = (data as Record<string, unknown>).message;
  return typeof message === 'string' ? message : null;
}

/**
 * 임의의 에러를 환자 친화 메시지로 변환한다.
 * 상태코드별 고정 안내문이 우선이며, 그 외에는 서버 message → 기본 문구 순.
 */
export function toQuizErrorInfo(err: unknown): QuizErrorInfo {
  const status = extractStatus(err);

  if (status === 410) {
    return {
      message: '시간이 초과됐어요. 다시 시작할까요?',
      status,
      isSessionExpired: true,
      isNotReady: false,
    };
  }
  if (status === 409) {
    return {
      message: '아직 준비 중이에요. 잠시 후 다시 시도해주세요.',
      status,
      isSessionExpired: false,
      isNotReady: true,
    };
  }
  if (status === 422) {
    return {
      message: '답안 형식을 다시 확인해주세요.',
      status,
      isSessionExpired: false,
      isNotReady: false,
    };
  }
  if (status === 403) {
    return {
      message: '이 퀴즈에 접근할 수 없어요.',
      status,
      isSessionExpired: false,
      isNotReady: false,
    };
  }
  if (status === 404) {
    return {
      message: '퀴즈를 찾을 수 없어요.',
      status,
      isSessionExpired: false,
      isNotReady: false,
    };
  }

  const serverMessage = extractServerMessage(err);
  if (serverMessage !== null) {
    return {
      message: serverMessage,
      status,
      isSessionExpired: false,
      isNotReady: false,
    };
  }

  if (err instanceof Error && err.message.length > 0) {
    return {
      message: err.message,
      status,
      isSessionExpired: false,
      isNotReady: false,
    };
  }

  return {
    message: '잠시 문제가 생겼어요. 다시 시도해주세요.',
    status,
    isSessionExpired: false,
    isNotReady: false,
  };
}
