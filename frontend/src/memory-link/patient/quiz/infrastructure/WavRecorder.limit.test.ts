import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WavRecorder } from './WavRecorder.js';
import {
  BYTES_PER_SECOND,
  QUIZ_RECORDING_LIMIT_MS,
} from './recordingLimits.js';

/**
 * 녹음 길이 상한 회귀 테스트.
 *
 * 배경: 클라이언트에 상한이 없어서, 무음 감지가 실패하는 환경(TV 소리가
 * 계속되는 거실·요양시설)에서는 녹음이 끝나지 않고 메모리에 계속 쌓였다.
 * 그리고 서버 크기 상한에 걸리는 건 업로드 시점이라, 환자가 몇 분을 말한
 * 뒤에야 거부되고 답변이 통째로 사라졌다.
 */
describe('WavRecorder 녹음 상한', () => {
  let processorNode: { onaudioprocess: ((e: unknown) => void) | null; connect: () => void; disconnect: () => void };
  let trackStopped: number;

  beforeEach(() => {
    vi.useFakeTimers();
    trackStopped = 0;
    processorNode = {
      onaudioprocess: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    // `new Ctor()`로 호출되므로 화살표 함수 목은 쓸 수 없다.
    class FakeAudioContext {
      sampleRate = 16000;
      destination = {};
      createMediaStreamSource() {
        return { connect: () => {}, disconnect: () => {} };
      }
      createScriptProcessor() {
        return processorNode;
      }
      close() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() =>
          Promise.resolve({
            getTracks: () => [{ stop: () => { trackStopped += 1; } }],
          }),
        ),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('상한에 닿으면 스스로 멈추고 콜백을 부른다', async () => {
    const onLimitReached = vi.fn();
    const recorder = new WavRecorder({ maxDurationMs: 30_000, onLimitReached });
    await recorder.start();

    expect(onLimitReached).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);

    expect(onLimitReached).toHaveBeenCalledTimes(1);
    expect(recorder.didHitLimit).toBe(true);
    // 마이크가 실제로 꺼져야 더 쌓이지 않는다.
    expect(trackStopped).toBeGreaterThan(0);
  });

  it('상한 전에는 멈추지 않는다', async () => {
    const onLimitReached = vi.fn();
    const recorder = new WavRecorder({ maxDurationMs: 30_000, onLimitReached });
    await recorder.start();

    vi.advanceTimersByTime(29_999);

    expect(onLimitReached).not.toHaveBeenCalled();
    expect(recorder.didHitLimit).toBe(false);
  });

  it('상한에 닿아도 그때까지 녹음된 발화는 살아남는다', async () => {
    // 이것이 이 설계의 핵심이다. 서버가 크기로 거부하면 답변이 통째로
    // 사라지지만, 여기서 끊으면 그때까지의 발화는 정상 인식된다.
    const recorder = new WavRecorder({ maxDurationMs: 30_000 });
    await recorder.start();

    processorNode.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.5) },
    });
    vi.advanceTimersByTime(30_000);

    const blob = await recorder.stop();
    // WAV 헤더(44B)만 있는 빈 파일이 아니어야 한다.
    expect(blob.size).toBeGreaterThan(44);
  });

  it('먼저 stop()하면 상한 타이머가 뒤늦게 터지지 않는다', async () => {
    const onLimitReached = vi.fn();
    const recorder = new WavRecorder({ maxDurationMs: 30_000, onLimitReached });
    await recorder.start();

    await recorder.stop();
    vi.advanceTimersByTime(60_000);

    expect(onLimitReached).not.toHaveBeenCalled();
  });

  it('상한을 주지 않으면 자동 종료하지 않는다 (기존 호출자 호환)', async () => {
    const recorder = new WavRecorder();
    await recorder.start();

    vi.advanceTimersByTime(10 * 60_000);

    expect(recorder.didHitLimit).toBe(false);
  });

  it('퀴즈 상한이 서버 크기 상한 안에 들어온다', () => {
    // 클라이언트가 먼저 끊어야 서버 413이 안 난다. 이 관계가 깨지면
    // 환자가 길게 말한 답변이 업로드 시점에 통째로 버려진다.
    const SERVER_LIMIT_BYTES = 4 * 1024 * 1024;
    const worstCase = (QUIZ_RECORDING_LIMIT_MS / 1000) * BYTES_PER_SECOND;

    expect(worstCase).toBeLessThan(SERVER_LIMIT_BYTES);
  });
});
