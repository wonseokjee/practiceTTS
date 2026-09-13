// dailyLimit — 서버 일일 생성 상한 429만 골라 안내 문구를 돌려준다.

import { describe, expect, it } from 'vitest';
import {
  DAILY_GENERATION_LIMIT,
  DAILY_LIMIT_FALLBACK,
  dailyLimitMessage,
} from './dailyLimit.js';

/** axios.isAxiosError가 알아보는 모양의 에러 */
function axiosError(status: number, data: unknown): unknown {
  return { isAxiosError: true, response: { status, data } };
}

describe('dailyLimitMessage', () => {
  it('일일 상한 429면 서버 문구를 그대로 쓴다', () => {
    const err = axiosError(429, {
      code: DAILY_GENERATION_LIMIT,
      message: '오늘은 여기까지예요. 내일 다시 이어서 해요.',
    });
    expect(dailyLimitMessage(err)).toBe(
      '오늘은 여기까지예요. 내일 다시 이어서 해요.',
    );
  });

  it('서버가 문구를 안 주면 기본 안내', () => {
    expect(
      dailyLimitMessage(axiosError(429, { code: DAILY_GENERATION_LIMIT })),
    ).toBe(DAILY_LIMIT_FALLBACK);
  });

  it('다른 429(잠깐 뒤 풀리는 레이트리밋)는 고르지 않는다', () => {
    expect(
      dailyLimitMessage(
        axiosError(429, { message: '요청이 너무 잦습니다.', retryAfter: 30 }),
      ),
    ).toBeNull();
  });

  it.each([
    ['500', axiosError(500, { code: DAILY_GENERATION_LIMIT })],
    ['응답 없음(네트워크)', { isAxiosError: true }],
    ['일반 Error', new Error('boom')],
    ['null', null],
  ])('%s → null', (_label, err) => {
    expect(dailyLimitMessage(err)).toBeNull();
  });
});
