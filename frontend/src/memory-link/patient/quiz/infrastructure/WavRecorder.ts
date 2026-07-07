// 브라우저 마이크 PCM 녹음 → 16kHz mono 16bit WAV Blob.
//
// 서버 STT(Azure)는 WAV(PCM 16kHz mono)를 바로 받으므로, 프론트에서 이 포맷으로
// 인코딩해 보내면 서버 변환(ffmpeg)이 필요 없다. MediaRecorder(webm/opus) 대신
// AudioContext로 원시 PCM을 수집한 뒤 16kHz로 리샘플링하고 WAV로 인코딩한다.
//
// 참고: ScriptProcessorNode는 deprecated이나 구현이 단순하고 광범위 지원되어
//       현 단계에서 채택한다(추후 AudioWorklet로 교체 가능).

const TARGET_SAMPLE_RATE = 16000;

/** 브라우저 마이크를 WAV(16kHz mono)로 녹음한다. */
export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private sourceSampleRate = 48000;

  /** 마이크 권한을 얻고 녹음을 시작한다. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
    });
    // getUserMedia로 마이크가 켜진 뒤 AudioContext 구성 중 예외가 나면 트랙/컨텍스트가
    // 누수된다(마이크 표시 켜진 채 유지). 실패 시 반드시 정리하고 다시 던진다.
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.sourceSampleRate = this.ctx.sampleRate;
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
      this.chunks = [];
      this.processor.onaudioprocess = (event) => {
        // 채널 데이터를 복사해 누적(버퍼는 재사용되므로 복사 필수).
        this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      this.source.connect(this.processor);
      this.processor.connect(this.ctx.destination);
    } catch (err) {
      this.stream?.getTracks().forEach((track) => track.stop());
      if (this.ctx) void this.ctx.close();
      this.ctx = null;
      this.processor = null;
      this.source = null;
      this.stream = null;
      throw err;
    }
  }

  /** 녹음을 종료하고 16kHz mono WAV Blob을 반환한다. */
  async stop(): Promise<Blob> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());

    const merged = mergeChunks(this.chunks);
    const resampled = resampleLinear(
      merged,
      this.sourceSampleRate,
      TARGET_SAMPLE_RATE,
    );

    if (this.ctx) {
      await this.ctx.close();
    }
    this.ctx = null;
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.chunks = [];

    return encodeWav(resampled, TARGET_SAMPLE_RATE);
  }
}

/** Float32 청크들을 하나로 병합. */
export function mergeChunks(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** 선형 보간 리샘플링 (from → to Hz). from===to면 그대로 반환. */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Float32 PCM([-1,1]) → 16bit PCM WAV Blob. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
