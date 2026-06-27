// 말운동(DDK) 녹음기 — 마이크 음량 포락선을 모아 음절 반복 횟수를 센다.
//
// Web Audio(getUserMedia + AnalyserNode)로 일정 간격마다 RMS 음량을 샘플링해
// 포락선을 만들고, 정지 시 countSyllables로 피크(음절) 수를 계산한다.
// 테스트에서는 IDdkRecorder를 목으로 주입하므로 이 구현체는 브라우저 전용이다.

import { countSyllables } from '../domain/ddkScore.js';

export interface DdkResult {
  /** 감지된 음절(피크) 수 */
  count: number;
  /** 실제 녹음 시간(ms) */
  durationMs: number;
}

export interface IDdkRecorder {
  /** 녹음 시작 (마이크 권한 요청 포함). 실패 시 reject. */
  start(): Promise<void>;
  /** 녹음 정지 후 음절 수 분석 결과 반환. */
  stop(): Promise<DdkResult>;
}

/** 포락선 샘플링 간격(ms). 50ms = 20fps. */
const SAMPLE_INTERVAL_MS = 50;

/** Web Audio 기반 DDK 녹음기. */
export class WebAudioDdkRecorder implements IDdkRecorder {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private envelope: number[] = [];
  private startedAt = 0;

  async start(): Promise<void> {
    this.envelope = [];
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // getUserMedia 성공 후 오디오 그래프 구성이 실패하면(브라우저별 AudioContext
    // 제약 등) 스트림이 살아 마이크가 켜진 채 남으므로, 실패 시 즉시 정리한다.
    let analyser: AnalyserNode;
    try {
      const AudioCtor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioCtx = new AudioCtor();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
    } catch (err) {
      this.stream.getTracks().forEach((t) => t.stop());
      if (this.audioCtx !== null) void this.audioCtx.close();
      this.stream = null;
      this.audioCtx = null;
      throw err;
    }

    const buffer = new Uint8Array(analyser.fftSize);
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      // RMS 음량 (128 중심에서의 편차).
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const v = (buffer[i] - 128) / 128;
        sumSq += v * v;
      }
      this.envelope.push(Math.sqrt(sumSq / buffer.length));
    }, SAMPLE_INTERVAL_MS);
  }

  async stop(): Promise<DdkResult> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const durationMs = this.startedAt > 0 ? Date.now() - this.startedAt : 0;
    const count = countSyllables(this.envelope);

    // 리소스 정리.
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audioCtx !== null) {
      void this.audioCtx.close();
    }
    this.stream = null;
    this.audioCtx = null;

    return { count, durationMs };
  }
}
