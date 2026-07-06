import { describe, it, expect, vi, afterEach } from 'vitest';
import { ServerSttService } from './ServerSttService.js';

// WavRecorder는 실제 오디오 API를 쓰므로, 고정 WAV Blob을 반환하도록 mock한다.
vi.mock('./WavRecorder.js', () => ({
  WavRecorder: class {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }));
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  // start()의 recorder.start() 및 stop()의 recognize() 파이프라인을 흘려보낸다.
  await Promise.resolve();
  await Promise.resolve();
}

describe('ServerSttService', () => {
  it('녹음 후 /stt 응답 transcript로 onResult, candidates를 phrase hint로 전송', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transcript: '바다', confidence: 0.9 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const svc = new ServerSttService('ko-KR');
    const onResult = vi.fn();
    svc.onResult = onResult;

    svc.start(['바다', '파도']);
    await flush();
    svc.stop();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());

    expect(onResult).toHaveBeenCalledWith({ transcript: '바다', confidence: 0.9 });
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body.getAll('candidates')).toEqual(['바다', '파도']);
    expect(body.get('lang')).toBe('ko-KR');
  });

  it('빈 transcript면 onError(다시 말하기 유도)', async () => {
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
  });

  it('서버 오류(!ok)면 onError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const svc = new ServerSttService();
    const onError = vi.fn();
    svc.onError = onError;

    svc.start();
    await flush();
    svc.stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('녹음 시작 완료 전에 stop이 눌려도(경합) 인식이 진행된다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transcript: '바다', confidence: 0.8 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const svc = new ServerSttService();
    const onResult = vi.fn();
    svc.onResult = onResult;

    // flush 없이 즉시 stop() → recorder.start()가 아직 resolve되기 전 경합.
    svc.start(['바다']);
    svc.stop();

    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ transcript: '바다', confidence: 0.8 }),
    );
  });

  it('서버 응답이 지연되면 타임아웃(abort) 후 onError', async () => {
    vi.useFakeTimers();
    // 응답을 미루다가 signal이 abort되면 거부하는 fetch mock.
    const fetchMock = vi.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const svc = new ServerSttService();
    const onError = vi.fn();
    svc.onError = onError;

    svc.start();
    await vi.advanceTimersByTimeAsync(1); // recorder.start()/stop() 마이크로태스크 소진
    svc.stop();
    await vi.advanceTimersByTimeAsync(10000); // FETCH_TIMEOUT_MS 도달 → abort

    expect(onError).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
