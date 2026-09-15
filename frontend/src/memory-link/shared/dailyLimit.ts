// 일일 생성 상한 안내 — 서버 DailyCapGuard(backend/src/usage)의 429를 알아본다.
//
// 기억 등록·수동 퀴즈 생성·시나리오·대화 메시지는 하루 상한이 있다. 상한은
// 정상 사용을 한참 넘는 값이라 실제로 닿는 일은 드물지만, 닿았을 때 "실패했어요,
// 다시 시도해주세요"를 보여주면 보호자는 계속 다시 누른다 — 내일까지는 몇 번을
// 눌러도 같은 답이다. 그래서 이 429만은 따로 알아보고 서버 문구를 그대로 쓴다.
//
// 다른 429(인증·STT 레이트리밋)는 잠깐 뒤 풀리는 종류라 여기서 고르지 않는다.

import axios from 'axios';
import { i18n } from '../../shared/i18n/i18n.js';

/** 서버 429 본문의 code (backend/src/usage/daily-cap.guard.ts와 같은 값). */
export const DAILY_GENERATION_LIMIT = 'DAILY_GENERATION_LIMIT';

/** 서버가 문구를 안 줬을 때의 기본 안내. 서버 문구와 같다. */
export function dailyLimitFallback(): string {
  return i18n.t('errors.dailyLimitFallback', { ns: 'common' });
}

/**
 * 일일 상한 429면 보여줄 문구를, 아니면 null을 돌려준다.
 * null이면 호출부가 원래 하던 에러 처리를 그대로 한다.
 */
export function dailyLimitMessage(error: unknown): string | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 429) {
    return null;
  }
  const data: unknown = error.response.data;
  if (typeof data !== 'object' || data === null) return null;
  const body = data as Record<string, unknown>;
  if (body.code !== DAILY_GENERATION_LIMIT) return null;
  return typeof body.message === 'string' && body.message.length > 0
    ? body.message
    : dailyLimitFallback();
}
