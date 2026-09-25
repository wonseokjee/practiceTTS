// 서버 오류 코드 → i18n 문구 (영어판 실행 계획 §17 D2)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../shared/domain/locale.js';
import { extractErrorMessage } from './extractErrorMessage.js';

const HANGUL = /[가-힣]/;
const failure = (data: Record<string, unknown>) => ({ response: { data } });

describe('extractErrorMessage — 서버 오류 코드', () => {
  afterEach(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('en-US: 코드가 있으면 서버의 한국어 message 대신 영어 문구', async () => {
    await i18n.changeLanguage('en-US');
    const text = extractErrorMessage(
      failure({ code: 'AUTH_EMAIL_TAKEN', message: '이미 사용 중인 이메일입니다.' }),
    );
    expect(text).toBe('This email is already in use.');
    expect(text).not.toMatch(HANGUL);
  });

  it('ko-KR: 같은 코드가 한국어 문구', () => {
    expect(
      extractErrorMessage(failure({ code: 'AUTH_EMAIL_TAKEN', message: 'x' })),
    ).toBe('이미 사용 중인 이메일입니다.');
  });

  it('알 수 없는 코드는 서버 message로 폴백한다(구·신 버전 호환)', () => {
    expect(
      extractErrorMessage(failure({ code: 'SOMETHING_NEW', message: '서버 문구' })),
    ).toBe('서버 문구');
  });

  it('코드 없는 응답은 예전처럼 message를 그대로', () => {
    expect(extractErrorMessage(failure({ message: '그냥 메시지' }))).toBe(
      '그냥 메시지',
    );
  });

  it('retryAfterSec을 문구에 끼운다', async () => {
    await i18n.changeLanguage('en-US');
    expect(
      extractErrorMessage(
        failure({ code: 'AUTH_RATE_LIMITED', message: 'x', retryAfterSec: 12 }),
      ),
    ).toBe('Please try again in 12 seconds.');
  });

  it('백엔드 AUTH_ERRORS의 모든 코드에 ko·en 문구가 있다', async () => {
    // vitest는 frontend/에서 돈다
    const src = readFileSync(
      resolve(process.cwd(), '../backend/src/common/error-codes.ts'),
      'utf-8',
    );
    const codes = [...src.matchAll(/code: '(AUTH_[A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(10);
    for (const lng of ['ko-KR', 'en-US']) {
      await i18n.changeLanguage(lng);
      for (const code of codes) {
        expect(
          i18n.exists(`errors.server.${code}`, { ns: 'common' }),
          `${lng} ${code}`,
        ).toBe(true);
      }
    }
  });
});
