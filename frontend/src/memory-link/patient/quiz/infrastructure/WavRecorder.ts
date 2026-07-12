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
    const resampled = downsample(
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

/** 안티앨리어싱 FIR 저역통과의 기본 탭 수(홀수, 선형위상 대칭). */
const DEFAULT_LOWPASS_TAPS = 127;

/**
 * 윈도우드-sinc(Hann) FIR 저역통과 필터를 적용한다.
 *
 * 다운샘플 전 나이퀴스트 초과 성분을 제거해 앨리어싱을 막는다. 선형보간만으로
 * 데시메이션하면 8kHz(16k 나이퀴스트) 초과 성분이 접혀 고주파 자음(ㅅ/ㅊ/ㅎ,
 * 파찰음)의 명료도를 떨어뜨리는데, 이는 구음장애 환자가 가장 어려워하는 소리라
 * 재활 STT 정확도에 특히 불리하다.
 *
 * - 이상적 sinc 저역통과에 Hann 창을 곱해 링잉을 억제한 선형위상 FIR.
 * - DC 게인이 1이 되도록 정규화(음량 보존).
 * - 경계는 zero-pad('same' 컨볼루션)로 처리 — 양끝 소수 샘플만 감쇠(무시 가능).
 *
 * @param cutoffHz 차단 주파수(Hz)
 * @param numTaps  탭 수(짝수면 +1 하여 홀수화)
 */
export function lowPassFir(
  input: Float32Array,
  sampleRate: number,
  cutoffHz: number,
  numTaps: number = DEFAULT_LOWPASS_TAPS,
): Float32Array {
  if (input.length === 0) return input;

  const taps = numTaps % 2 === 0 ? numTaps + 1 : numTaps;
  const mid = (taps - 1) / 2;
  const fc = cutoffHz / sampleRate; // 정규화 주파수(cycles/sample), 0..0.5

  // 계수 설계: 이상적 sinc × Hann 창, DC 게인 1로 정규화
  const coeffs = new Float32Array(taps);
  let sum = 0;
  for (let n = 0; n < taps; n += 1) {
    const k = n - mid;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1));
    const h = sinc * hann;
    coeffs[n] = h;
    sum += h;
  }
  for (let n = 0; n < taps; n += 1) coeffs[n] /= sum;

  // 중심 정렬('same' 길이) 컨볼루션 — 선형위상 지연을 보정
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    let acc = 0;
    for (let j = 0; j < taps; j += 1) {
      const idx = i + j - mid;
      if (idx >= 0 && idx < input.length) acc += input[idx] * coeffs[j];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * 안티앨리어싱 다운샘플: 다운샘플 시 저역통과 후 선형보간, 그 외엔 선형보간만.
 *
 * 차단 주파수는 목표 나이퀴스트 아래(0.45×toRate)로 두어 접힘 성분을 확실히
 * 억제한다. 업샘플/동일 레이트에서는 앨리어싱이 없으므로 필터를 생략한다.
 */
export function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  if (toRate < fromRate) {
    const cutoffHz = 0.45 * toRate; // 16k 목표 → 7200Hz
    const filtered = lowPassFir(input, fromRate, cutoffHz);
    return resampleLinear(filtered, fromRate, toRate);
  }
  return resampleLinear(input, fromRate, toRate);
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
