// ServerSttService·SpeechCaptureService(ServerPronunciationService)의 onError
// 문구를 영어로 낸다(영어판 Phase 1-2, 인프라 쪽 문구)

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import { ServerSttService } from './ServerSttService.js';
import { ServerPronunciationService } from './SpeechCaptureService.js';

vi.mock('./WavRecorder.js', () => ({
  WavRecorder: class {
    start = vi.fn(() => Promise.resolve());
    stop = vi.fn(() => Promise.resolve(new Blob(['wav'], { type: 'audio/wav' })));
  },
}));

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('quiz STT 오류 문구 — 영어로 나온다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('ServerSttService — 빈 transcript면 영어 안내', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transcript: '' }) }),
    );
    const svc = new ServerSttService();
    const onError = vi.fn();
    svc.onError = onError;

    svc.start();
    await flush();
    svc.stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());

    expect(onError).toHaveBeenCalledWith("We didn't catch that. Please try speaking again.");
  });

  it('ServerSttService — 서버 오류(!ok)면 영어 안내', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const svc = new ServerSttService();
    const onError = vi.fn();
    svc.onError = onError;

    svc.start();
    await flush();
    svc.stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());

    expect(onError).toHaveBeenCalledWith(
      "We couldn't reach the speech recognition server. Please try again shortly.",
    );
  });

  it('ServerPronunciationService — 평가·STT 둘 다 실패하면 영어 안내', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const svc = new ServerPronunciationService();
    const onError = vi.fn();
    svc.onError = onError;

    svc.start('사과');
    await flush();
    svc.stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());

    expect(onError).toHaveBeenCalledWith(
      "We couldn't reach the pronunciation server. Please try again shortly.",
    );
  });
});
