// 에러 → 사용자 표시 메시지 추출 (공용)
//
// memory-link 전역에서 중복되던 추출 로직을 일원화한다.
// 우선순위:
//   1) axios 에러: 서버 오류 코드(i18n) > 서버가 준 message > 네트워크 끊김 > 일반 처리 오류
//   2) duck-typed 객체(테스트 mock 등): response.data.message
//   3) Error 인스턴스: error.message
//   4) 그 외: 기본 안내
//
// (axios 인스턴스가 아닌 평범한 객체로 reject하는 단위 테스트도 그대로 지원하기 위해
//  axios 경로와 duck-typed 경로를 모두 둔다 — 기존 호출부 동작 보존.)

import axios from 'axios';
import { i18n } from '../../shared/i18n/i18n.js';

/**
 * 서버가 준 오류 코드(`data.code`)에 맞는 i18n 문구. 코드가 없거나 아직 문구가 없는
 * 코드면 null — 그때는 서버 message(한국어 폴백)를 그대로 쓴다.
 */
function serverErrorText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { code, retryAfterSec } = data as Record<string, unknown>;
  if (typeof code !== 'string') return null;
  const key = `errors.server.${code}`;
  if (!i18n.exists(key, { ns: 'common' })) return null;
  return i18n.t(key, { ns: 'common', retryAfterSec });
}

export function extractErrorMessage(error: unknown): string {
  // 1) 실제 axios 에러
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    const coded = serverErrorText(data);
    if (coded !== null) return coded;
    if (
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof (data as Record<string, unknown>).message === 'string'
    ) {
      return (data as Record<string, string>).message;
    }
    if (error.response === undefined) {
      return i18n.t('errors.networkUnavailable', { ns: 'common' });
    }
    return i18n.t('errors.requestFailed', { ns: 'common' });
  }

  // 2) duck-typed 객체 (예: { response: { data: { message } } })
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    const res = obj.response;
    if (typeof res === 'object' && res !== null) {
      const data = (res as Record<string, unknown>).data;
      const coded = serverErrorText(data);
      if (coded !== null) return coded;
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

  return i18n.t('errors.unknown', { ns: 'common' });
}
