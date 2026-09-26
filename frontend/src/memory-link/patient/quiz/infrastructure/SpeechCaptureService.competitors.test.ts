import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ServerPronunciationService,
  parseCompetitorInfo,
  type SpeechCaptureResult,
} from './SpeechCaptureService.js';

// 이웃 비교 채점의 클라이언트 쪽: 이웃을 요청 폼에 싣고, 경쟁자 응답을 정리해 결과에 담는다.
// 판정(정답·모호·오답)은 domain/neighborScoring.ts의 몫이라 여기서는 요청·응답의 모양만 본다.

// WavRecorder는 실제 오디오 API를 쓰므로 대체한다(ServerSttService.test.ts와 같은 방식).
vi.mock('./WavRecorder.js', () => ({
  WavRecorder: class {
    start = vi.fn(() => Promise.resolve());
    stop = vi.fn(() => Promise.resolve(new Blob(['wav'], { type: 'audio/wav' })));
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const PRON_OK = {
  recognized_text: '고래',
  accuracy_score: 90,
  fluency_score: 80,
  completeness_score: 100,
  pronunciation_score: 88,
  prosody_score: null,
};

const COMPETITOR_FIELDS = {
  competitor_scores: [
    { text: '구름', source: 'neighbor', accuracy_score: 20, recognized_text: '구름', status: 'ok' },
    { text: '노래', source: 'stt', accuracy_score: 0, recognized_text: '', status: 'no_match' },
  ],
  stt_transcript: '노래',
  stt_status: 'ok',
  competitors_skipped: null,
};

/** 한 번 녹음해 결과를 받는다. fetchMock의 n번째 호출 응답을 지정한다. */
async function record(
  responses: unknown[],
  start: (svc: ServerPronunciationService) => void,
): Promise<{ result: SpeechCaptureResult; calls: FormData[]; urls: string[] }> {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fetchMock);

  const svc = new ServerPronunciationService('ko-KR');
  const onResult = vi.fn();
  svc.onResult = onResult;
  start(svc);
  await Promise.resolve();
  await Promise.resolve();
  svc.stop();
  await vi.waitFor(() => expect(onResult).toHaveBeenCalled());
  return {
    result: onResult.mock.calls[0][0] as SpeechCaptureResult,
    calls: fetchMock.mock.calls.map((c) => c[1].body as FormData),
    urls: fetchMock.mock.calls.map((c) => String(c[0])),
  };
}

const ok = (json: unknown) => ({ ok: true, json: async () => json });

describe('ServerPronunciationService — 이웃 비교 요청', () => {
  it('이웃을 주면 competitors와 stt_competitor를 폼에 싣는다', async () => {
    const { calls, urls } = await record(
      [ok({ ...PRON_OK, ...COMPETITOR_FIELDS })],
      (svc) => svc.start('고래', { neighbors: ['구름', '가위', '노래'] }),
    );
    expect(urls[0]).toMatch(/\/ai\/pronunciation$/);
    expect(calls[0].get('reference_text')).toBe('고래');
    expect(calls[0].get('competitors')).toBe(JSON.stringify(['구름', '가위', '노래']));
    expect(calls[0].get('stt_competitor')).toBe('true');
  });

  it('이웃이 없으면 폼이 예전과 같다 — 옵션 없음·빈 배열 모두', async () => {
    for (const startFn of [
      (svc: ServerPronunciationService) => svc.start('고래'),
      (svc: ServerPronunciationService) => svc.start('고래', {}),
      (svc: ServerPronunciationService) => svc.start('고래', { neighbors: [] }),
    ]) {
      const { calls, result } = await record([ok(PRON_OK)], startFn);
      expect([...calls[0].keys()].sort()).toEqual(['audio', 'lang', 'reference_text']);
      expect('competitors' in result).toBe(false); // undefined = 요청하지 않았다
    }
  });

  it('이웃은 시작할 때마다 새로 정한다 — 이전 문항의 이웃이 남지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(PRON_OK));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new ServerPronunciationService('ko-KR');
    const onResult = vi.fn();
    svc.onResult = onResult;

    svc.start('고래', { neighbors: ['구름'] });
    await Promise.resolve();
    await Promise.resolve();
    svc.stop();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));

    svc.start('사탕'); // 이웃 없이
    await Promise.resolve();
    await Promise.resolve();
    svc.stop();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));

    const second = fetchMock.mock.calls[1][1].body as FormData;
    expect(second.has('competitors')).toBe(false);
    expect(second.has('stt_competitor')).toBe(false);
  });
});

describe('ServerPronunciationService — 경쟁자 응답', () => {
  it('경쟁자 필드를 정리해 결과에 담는다(snake_case → camelCase)', async () => {
    const { result } = await record(
      [ok({ ...PRON_OK, ...COMPETITOR_FIELDS })],
      (svc) => svc.start('고래', { neighbors: ['구름'] }),
    );
    expect(result.azure?.accuracyScore).toBe(90);
    expect(result.competitors).toEqual({
      scores: [
        { text: '구름', source: 'neighbor', accuracyScore: 20, recognizedText: '구름', status: 'ok' },
        { text: '노래', source: 'stt', accuracyScore: 0, recognizedText: '', status: 'no_match' },
      ],
      sttTranscript: '노래',
      sttStatus: 'ok',
      skipped: null,
    });
  });

  it('서버가 경쟁자를 건너뛴 응답은 scores가 null이고 이유를 담는다', async () => {
    const { result } = await record(
      [
        ok({
          ...PRON_OK,
          accuracy_score: 40,
          stt_transcript: '노래',
          stt_status: 'ok',
          competitors_skipped: 'target_below_pass',
        }),
      ],
      (svc) => svc.start('고래', { neighbors: ['구름'] }),
    );
    expect(result.competitors).toEqual({
      scores: null,
      sttTranscript: '노래',
      sttStatus: 'ok',
      skipped: 'target_below_pass',
    });
  });

  it('요청했는데 옛 서버라 경쟁자 필드가 없으면 null이다 — 요청 안 한 undefined와 다르다', async () => {
    const { result } = await record([ok(PRON_OK)], (svc) =>
      svc.start('고래', { neighbors: ['구름'] }),
    );
    expect(result.competitors).toBeNull();
  });

  it('발음 평가가 실패해 인식으로 폴백해도, 요청했던 시도는 null로 표시한다', async () => {
    const { result, urls } = await record(
      [{ ok: false }, ok({ transcript: '고래', confidence: 0.9 })],
      (svc) => svc.start('고래', { neighbors: ['구름'] }),
    );
    expect(urls[1]).toMatch(/\/ai\/stt$/);
    expect(result.azure).toBeNull();
    expect(result.competitors).toBeNull();
  });

  it('요청하지 않은 시도가 폴백하면 competitors 키가 없다', async () => {
    const { result } = await record(
      [{ ok: false }, ok({ transcript: '고래', confidence: 0.9 })],
      (svc) => svc.start('고래'),
    );
    expect(result.azure).toBeNull();
    expect('competitors' in result).toBe(false);
  });
});

describe('parseCompetitorInfo', () => {
  it('stt_status가 있으면 경쟁자 모드 응답이다 — 값이 null이어도 있는 것이다', () => {
    expect(parseCompetitorInfo({ stt_status: null })).toEqual({
      scores: null,
      sttTranscript: null,
      sttStatus: null,
      skipped: null,
    });
    expect(parseCompetitorInfo({})).toBeNull();
  });

  it('error 상태를 그대로 전한다 — 판정이 채점 불가로 보낸다', () => {
    const info = parseCompetitorInfo({
      stt_status: 'error',
      competitor_scores: [
        { text: '구름', source: 'neighbor', accuracy_score: 0, recognized_text: '', status: 'error' },
      ],
    });
    expect(info?.sttStatus).toBe('error');
    expect(info?.scores?.[0].status).toBe('error');
  });
});
