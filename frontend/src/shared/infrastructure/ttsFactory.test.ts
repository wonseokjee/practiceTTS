import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTtsService } from './ttsFactory.js';
import { AzureTtsService } from './AzureTtsService.js';
import { WebSpeechTtsService } from './WebSpeechTtsService.js';
import { serverVoiceFor } from './ttsVoices.js';

describe('로케일 → 음성 맵', () => {
  it('ko-KR은 서버 음성이 있다', () => {
    expect(serverVoiceFor('ko-KR')).toBe('ko-KR-SunHiNeural');
  });

  it('en-US는 서버 음성이 아직 없다 — 한국어 음성으로 대신하지 않는다', () => {
    expect(serverVoiceFor('en-US')).toBeNull();
  });
});

describe('createTtsService', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('기본(ko-KR)은 서버 TTS를 쓴다', () => {
    vi.stubGlobal('Audio', class {});
    expect(createTtsService()).toBeInstanceOf(AzureTtsService);
    vi.unstubAllGlobals();
  });

  it('en-US는 Web Speech만 쓴다 — 한국어 서버 음성으로 영어를 읽지 않는다', () => {
    vi.stubGlobal('Audio', class {});
    expect(createTtsService('en-US')).toBeInstanceOf(WebSpeechTtsService);
    vi.unstubAllGlobals();
  });
});
