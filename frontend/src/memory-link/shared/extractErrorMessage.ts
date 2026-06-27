// 에러 → 사용자 표시 메시지 추출 (공용)
//
// memory-link 전역에서 중복되던 추출 로직을 일원화한다.
// 우선순위:
//   1) axios 에러: 서버가 준 message > 네트워크 끊김 > 일반 처리 오류
//   2) duck-typed 객체(테스트 mock 등): response.data.message
//   3) Error 인스턴스: error.message
//   4) 그 외: 기본 안내
//
// (axios 인스턴스가 아닌 평범한 객체로 reject하는 단위 테스트도 그대로 지원하기 위해
//  axios 경로와 duck-typed 경로를 모두 둔다 — 기존 호출부 동작 보존.)

import axios from 'axios';

export function extractErrorMessage(error: unknown): string {
  // 1) 실제 axios 에러
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof (data as Record<string, unknown>).message === 'string'
    ) {
      return (data as Record<string, string>).message;
    }
    if (error.response === undefined) {
      return '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.';
    }
    return '요청 처리 중 오류가 발생했습니다.';
  }

  // 2) duck-typed 객체 (예: { response: { data: { message } } })
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    const res = obj.response;
    if (typeof res === 'object' && res !== null) {
      const data = (res as Record<string, unknown>).data;
      if (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as Record<string, unknown>).message === 'string'
      ) {
        return (data as Record<string, string>).message;
      }
    }
    if (error instanceof Error) return error.message;
  }

  return '알 수 없는 오류가 발생했습니다.';
}
