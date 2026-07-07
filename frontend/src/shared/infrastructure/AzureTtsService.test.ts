import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureTtsService } from './AzureTtsService.js';
import type { IAudioPlayer } from '../domain/IAudioPlayer.js';
import type { ITtsService } from '../domain/ITtsService.js';

afterEach(() => {
  vi.useRealTimers();
});

function fakePlayer(overrides: Partial<IAudioPlayer> = {}): IAudioPlayer {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    // 실제 HtmlAudioPlayer처럼 재생 종료 시각(performance.now())을 반환한다.
    play: vi.fn().mockImplementation(() => Promise.resolve(performance.now())),
    stop: vi.fn(),
    isPlaying: false,
    isLoaded: true,
    ...overrides,
  } as IAudioPlayer;
}

function fakeFallback(): ITtsService {
  return { speak: vi.fn(), cancel: vi.fn() };
}

describe('AzureTtsService', () => {
  it('text/voice를 URL 인코딩해 /tts를 load하고 재생한다', async () => {
    const player = fakePlayer();
    const fallback = fakeFallback();
    const svc = new AzureTtsService(player, fallback, 'http://x', 'ko-KR-SunHiNeural');

    const result = await svc.speak('바다 사과');

    expect(player.load).toHaveBeenCalledWith(
      `http://x/tts?text=${encodeURIComponent('바다 사과')}&voice=ko-KR-SunHiNeural`,
    );
    expect(player.play).toHaveBeenCalled();
    expect(fallback.speak).not.toHaveBeenCalled();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('load 실패 시 fallback.speak로 위임한다', async () => {
    const player = fakePlayer({
      load: vi.fn().mockRejectedValue(new Error('404')),
    });
    const fallbackResult = { startTime: 0, endTime: 1, durationMs: 1 };
    const fallback: ITtsService = {
      speak: vi.fn().mockResolvedValue(fallbackResult),
      cancel: vi.fn(),
    };
    const svc = new AzureTtsService(player, fallback, 'http://x');

    const result = await svc.speak('바다');

    expect(fallback.speak).toHaveBeenCalledWith('바다');
    expect(result).toBe(fallbackResult);
  });

  it('play 실패 시에도 fallback으로 위임한다', async () => {
    const player = fakePlayer({
      play: vi.fn().mockRejectedValue(new Error('재생 실패')),
    });
    const fallback: ITtsService = {
      speak: vi.fn().mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 }),
      cancel: vi.fn(),
    };
    const svc = new AzureTtsService(player, fallback);

    await svc.speak('바다');

    expect(fallback.speak).toHaveBeenCalledWith('바다');
  });

  it('load가 지연되면 타임아웃 후 재생기를 멈추고 fallback으로 위임한다', async () => {
    vi.useFakeTimers();
    // load가 영원히 완료되지 않는 상황(서버 무응답).
    const player = fakePlayer({
      load: vi.fn().mockReturnValue(new Promise<void>(() => {})),
    });
    const fallbackResult = { startTime: 0, endTime: 0, durationMs: 0 };
    const fallback: ITtsService = {
      speak: vi.fn().mockResolvedValue(fallbackResult),
      cancel: vi.fn(),
    };
    const svc = new AzureTtsService(player, fallback, 'http://x');

    const pending = svc.speak('바다');
    await vi.advanceTimersByTimeAsync(10000); // LOAD_TIMEOUT_MS 도달
    const result = await pending;

    expect(player.stop).toHaveBeenCalled(); // hang 재생기 정리
    expect(player.play).not.toHaveBeenCalled(); // 재생 진입 안 함
    expect(fallback.speak).toHaveBeenCalledWith('바다');
    expect(result).toBe(fallbackResult);
  });

  it('cancel은 player.stop과 fallback.cancel을 모두 호출한다', () => {
    const player = fakePlayer();
    const fallback = fakeFallback();
    const svc = new AzureTtsService(player, fallback);

    svc.cancel();

    expect(player.stop).toHaveBeenCalled();
    expect(fallback.cancel).toHaveBeenCalled();
  });
});
