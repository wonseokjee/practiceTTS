/**
 * useWhisperSTT 훅 단위 테스트.
 *
 * 검증 대상:
 * (a) 녹음 시작/종료 흐름 — MediaRecorder 상태 전이와 SttApi 호출 확인
 * (b) 최소 녹음 시간 미만일 때 전송 차단 — 에러 메시지만 설정되고 API 미호출
 * (c) API 에러 처리 — SttApiError 또는 네트워크 오류 시 error 상태 설정
 *
 * 모킹 전략:
 * - navigator.mediaDevices.getUserMedia: vi.stubGlobal로 대체
 * - MediaRecorder: 최소 동작만 흉내내는 Mock 클래스
 * - SttApi.transcribe: vi.spyOn으로 격리
 * - performance.now: 순차 증가 시퀀스를 반환하도록 mockImplementation으로 제어
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWhisperSTT } from './useWhisperSTT.js';
import { SttApi, SttApiError } from '../infrastructure/SttApi.js';

// ---- MediaRecorder Mock ----
// 실제 MediaRecorder는 jsdom에 존재하지 않으므로 최소 인터페이스만 흉내낸다.
class MockMediaRecorder {
  public state: 'inactive' | 'recording' | 'paused' = 'inactive';
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;
  public stream: MediaStream;

  constructor(stream: MediaStream) {
    this.stream = stream;
    MockMediaRecorder.lastInstance = this;
  }

  static lastInstance: MockMediaRecorder | null = null;

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    // 실제 MediaRecorder처럼 ondataavailable → onstop 순서로 동기 호출
    this.ondataavailable?.({ data: new Blob(['mock-audio'], { type: 'audio/webm' }) });
    this.state = 'inactive';
    this.onstop?.();
  }
}

/** getUserMedia가 반환하는 MediaStream을 흉내내는 최소 객체. */
function makeFakeStream(): MediaStream {
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

/**
 * performance.now를 제어 가능한 가상 시계로 대체한다.
 * 호출할 때마다 currentTime을 반환하며, 테스트 내부에서 advance()로 시간을 진행시킨다.
 */
function installFakeClock(initial: number = 0): {
  advance: (ms: number) => void;
  restore: () => void;
} {
  let currentTime = initial;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => currentTime);
  return {
    advance: (ms: number) => {
      currentTime += ms;
    },
    restore: () => spy.mockRestore(),
  };
}

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(makeFakeStream()),
    },
  });
  MockMediaRecorder.lastInstance = null;
  vi.restoreAllMocks();
});

describe('useWhisperSTT', () => {
  it('(a) 녹음 시작 후 종료하면 SttApi.transcribe가 호출되고 transcript가 설정된다', async () => {
    const transcribeSpy = vi.spyOn(SttApi, 'transcribe').mockResolvedValue({
      text: '안녕하세요',
      language: 'ko',
      duration: 1.2,
      model_size: 'base',
    });

    const clock = installFakeClock(0);

    const onTranscribed = vi.fn();
    const { result } = renderHook(() =>
      useWhisperSTT({ onTranscribed, minDurationMs: 500 }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(MockMediaRecorder.lastInstance?.state).toBe('recording');

    // 시뮬레이션: 1500ms 경과 후 종료 → duration=1500ms (>= 500ms 최소치)
    clock.advance(1500);

    let returnedText: string | null = null;
    await act(async () => {
      returnedText = await result.current.stopAndTranscribe();
    });

    expect(returnedText).toBe('안녕하세요');
    expect(transcribeSpy).toHaveBeenCalledTimes(1);
    expect(transcribeSpy.mock.calls[0]?.[1]).toBe('ko');

    await waitFor(() => {
      expect(result.current.transcript).toBe('안녕하세요');
      expect(result.current.isRecording).toBe(false);
      expect(result.current.isTranscribing).toBe(false);
      expect(result.current.error).toBeNull();
    });
    expect(onTranscribed).toHaveBeenCalledWith('안녕하세요');

    clock.restore();
  });

  it('(b) 최소 녹음 시간(500ms) 미만이면 API 호출을 차단하고 에러 메시지를 설정한다', async () => {
    const transcribeSpy = vi.spyOn(SttApi, 'transcribe').mockResolvedValue({
      text: '호출되면 안 됨',
      language: 'ko',
      duration: 0.1,
      model_size: 'base',
    });

    const clock = installFakeClock(0);

    const { result } = renderHook(() => useWhisperSTT({ minDurationMs: 500 }));

    await act(async () => {
      await result.current.startRecording();
    });

    // 100ms만 경과 후 종료 → 최소 500ms 미만으로 차단되어야 함
    clock.advance(100);

    let returnedText: string | null = null;
    await act(async () => {
      returnedText = await result.current.stopAndTranscribe();
    });

    expect(returnedText).toBeNull();
    expect(transcribeSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.error).toContain('녹음이 너무 짧습니다');
      expect(result.current.isTranscribing).toBe(false);
    });

    clock.restore();
  });

  it('(c) SttApi가 에러를 던지면 error 상태를 설정하고 transcript를 비운다', async () => {
    vi.spyOn(SttApi, 'transcribe').mockRejectedValue(
      new SttApiError(500, 'Whisper 변환 실패'),
    );

    const clock = installFakeClock(0);

    const onTranscribed = vi.fn();
    const { result } = renderHook(() =>
      useWhisperSTT({ onTranscribed, minDurationMs: 500 }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    // 2000ms 경과 → 최소 기준 충족 → API 호출로 진입하지만 Mock이 에러를 던짐
    clock.advance(2000);

    let returnedText: string | null = null;
    await act(async () => {
      returnedText = await result.current.stopAndTranscribe();
    });

    expect(returnedText).toBeNull();
    expect(onTranscribed).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.error).toContain('변환 실패');
      expect(result.current.transcript).toBe('');
      expect(result.current.isTranscribing).toBe(false);
    });

    clock.restore();
  });
});
