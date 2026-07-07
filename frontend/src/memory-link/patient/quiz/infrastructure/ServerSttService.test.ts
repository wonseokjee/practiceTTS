import { describe, it, expect, vi, afterEach } from 'vitest';
import { ServerSttService } from './ServerSttService.js';

// WavRecorder는 실제 오디오 API를 쓰므로 제어 가능한 mock으로 대체한다.
// deferStart=true면 start()가 resolveStart() 호출 전까지 pending → 경합을 재현한다.
// stop()은 호출 시점의 started 상태를 startedWhenStopped에 기록한다(순서 검증용).
const { recorderCtl } = vi.hoisted(() => ({
  recorderCtl: {
    deferStart: false,
    resolveStart: null as (() => void) | null,
    startedWhenStopped: null as boolean | null,
  },
}));

vi.mock('./WavRecorder.js', () => ({
  WavRecorder: class {
    private started = false;
    start = vi.fn(() => {
      if (recorderCtl.deferStart) {
        return new Promise<void>((resolve) => {
          recorderCtl.resolveStart = () => {
            this.started = true;
            resolve();
          };
        });
      }
      this.started = true;
      return Promise.resolve();
    });
    stop = vi.fn(() => {
      recorderCtl.startedWhenStopped = this.started;
      return Promise.resolve(new Blob(['wav'], { type: 'audio/wav' }));
    });
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
  recorderCtl.deferStart = false;
  recorderCtl.resolveStart = null;
  recorderCtl.startedWhenStopped = null;
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

  it('경합: start 완료 전 stop이 눌리면 recorder.stop은 start 완료 후에만 호출된다', async () => {
    // start를 지연시켜 "시작 완료 전 stop" 상황을 강제한다.
    recorderCtl.deferStart = true;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transcript: '바다', confidence: 0.8 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const svc = new ServerSttService();
    const onResult = vi.fn();
    svc.onResult = onResult;

    svc.start(['바다']); // start pending
    svc.stop(); // 시작 완료 전 stop
    await Promise.resolve();
    await Promise.resolve();
    // recognize가 startPromise를 기다리므로 아직 recorder.stop이 호출되면 안 된다.
    // (수정 전에는 즉시 stop 호출 → started=false로 관측됐다.)
    expect(recorderCtl.startedWhenStopped).toBeNull();

    recorderCtl.resolveStart?.(); // 이제 start 완료
    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ transcript: '바다', confidence: 0.8 }),
    );
    // start 완료 후에 stop 호출됨을 확인(started=true).
    expect(recorderCtl.startedWhenStopped).toBe(true);
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
