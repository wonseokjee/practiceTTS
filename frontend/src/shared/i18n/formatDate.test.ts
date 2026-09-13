// formatDate — i18n 규약 3: 날짜 모양은 로케일이 정한다

import { describe, expect, it } from 'vitest';
import { formatDate } from './formatDate.js';
import { initI18n } from './i18n.js';

const D = new Date('2026-09-13T03:00:00Z');
const MONTH_DAY: Intl.DateTimeFormatOptions = {
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
};

describe('formatDate', () => {
  it('로케일마다 모양이 다르다 — 문구에 박으면 표현할 수 없는 차이', () => {
    expect(formatDate(D, MONTH_DAY, 'ko-KR')).toBe('9월 13일');
    expect(formatDate(D, MONTH_DAY, 'en-US')).toBe('September 13');
  });

  it('로케일을 안 넘기면 현재 화면 로케일(초기값 ko-KR)', async () => {
    await initI18n('ko-KR');
    expect(formatDate(D, MONTH_DAY)).toBe('9월 13일');
  });

  it('문자열·숫자 입력도 받는다', () => {
    expect(formatDate(D.toISOString(), MONTH_DAY, 'en-US')).toBe(
      'September 13',
    );
    expect(formatDate(D.getTime(), MONTH_DAY, 'en-US')).toBe('September 13');
  });
});
