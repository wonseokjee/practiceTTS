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
});
