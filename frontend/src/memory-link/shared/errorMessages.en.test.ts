// 공용 오류 문구를 영어로 낸다(영어판 Phase 1-2, 인프라 쪽 문구)
//
// extractErrorMessage·dailyLimit·SettingsApi·HealingMessageApi는 React 트리
// 밖의 순수 함수/서비스라 useTranslation 훅을 못 쓴다 — i18n.t(key, { ns })를
// 직접 부른다(quiz 네임스페이스의 TTS_FAILURE_MESSAGE_KEY 테스트와 같은 패턴).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../shared/domain/locale.js';
import { extractErrorMessage } from './extractErrorMessage.js';
import { DAILY_GENERATION_LIMIT, dailyLimitFallback, dailyLimitMessage } from './dailyLimit.js';

const getMock = vi.fn();
vi.mock('./MemoryLinkApi.js', () => ({
  memoryLinkApi: { get: (...args: unknown[]) => getMock(...args) },
}));

describe('공용 오류 문구 — 영어로 나온다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });
  beforeEach(() => {
    getMock.mockReset();
  });

  it('extractErrorMessage — 응답 없음(네트워크 끊김)', () => {
    expect(
      extractErrorMessage({ isAxiosError: true, response: undefined }),
    ).toBe("We couldn't reach the server. Please try again shortly.");
  });

  it('extractErrorMessage — 응답은 있으나 message 없음', () => {
    expect(
      extractErrorMessage({ isAxiosError: true, response: { status: 500, data: {} } }),
    ).toBe('Something went wrong processing that request.');
  });

  it('extractErrorMessage — 그 외(알 수 없는 오류)', () => {
    expect(extractErrorMessage('boom')).toBe('Something went wrong.');
  });

  it('dailyLimitFallback — 서버가 문구를 안 주면 기본 안내가 영어', () => {
    const err = { isAxiosError: true, response: { status: 429, data: { code: DAILY_GENERATION_LIMIT } } };
    expect(dailyLimitMessage(err)).toBe(dailyLimitFallback());
    expect(dailyLimitFallback()).toBe("That's it for today. Let's pick back up tomorrow.");
  });

  it('SettingsApi — 응답 형식이 어긋나면 영어 오류를 던진다', async () => {
    const { settingsApi } = await import('./SettingsApi.js');
    getMock.mockResolvedValue({ data: { bogus: true } });
    await expect(settingsApi.getLocale()).rejects.toThrow(
      'The server sent back an unexpected response.',
    );
  });

  it('HealingMessageApi — 응답 형식이 어긋나면 영어 오류를 던진다', async () => {
    const { healingMessageApi } = await import('./HealingMessageApi.js');
    getMock.mockResolvedValue({ data: { bogus: true } });
    await expect(healingMessageApi.fetchToday()).rejects.toThrow(
      'The server sent back an unexpected response.',
    );
  });
});
