import { describe, it, expect } from 'vitest';
import {
  encodeWav,
  resampleLinear,
  mergeChunks,
  lowPassFir,
  downsample,
} from './WavRecorder.js';

/** 지정 주파수의 사인파 생성. */
function sine(freqHz: number, sampleRate: number, length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

/** RMS(신호 세기). */
function rms(x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i += 1) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}

describe('mergeChunks', () => {
  it('여러 Float32 청크를 순서대로 병합한다', () => {
    const out = mergeChunks([
      new Float32Array([1, 2]),
      new Float32Array([3]),
      new Float32Array([4, 5]),
    ]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('빈 입력이면 길이 0', () => {
    expect(mergeChunks([]).length).toBe(0);
  });
});

describe('resampleLinear', () => {
  it('같은 레이트면 입력 참조를 그대로 반환(복사 안 함)', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
  });

  it('빈 입력이면 그대로 반환', () => {
    const input = new Float32Array(0);
    expect(resampleLinear(input, 48000, 16000)).toBe(input);
  });

  it('48k→16k 다운샘플은 길이를 약 1/3로 줄인다', () => {
    const input = new Float32Array(48);
    const out = resampleLinear(input, 48000, 16000);
    expect(out.length).toBe(16);
  });

  it('선형 보간으로 이웃 샘플 사이 값을 만든다', () => {
    // ratio = 4/2 = 2 → 출력 인덱스 0,1 이 입력 pos 0,2 를 샘플링
    const input = new Float32Array([0, 1, 2, 3]);
    const out = resampleLinear(input, 4, 2);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(2);
  });
});

describe('lowPassFir', () => {
  it('빈 입력이면 그대로 반환', () => {
    const input = new Float32Array(0);
    expect(lowPassFir(input, 48000, 7200)).toBe(input);
  });

  it('DC(상수) 신호는 게인 1로 통과시킨다', () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = lowPassFir(input, 48000, 7200);
    // 경계 왜곡을 피해 중앙 샘플 확인
    expect(out[2400]).toBeCloseTo(0.5, 3);
  });

  it('차단 아래 저주파(1kHz)는 세기를 대부분 보존한다', () => {
    const input = sine(1000, 48000, 4800);
    const ratio = rms(lowPassFir(input, 48000, 7200)) / rms(input);
    expect(ratio).toBeGreaterThan(0.9);
  });

  it('차단 위 고주파(12kHz)는 강하게 감쇠한다', () => {
    const input = sine(12000, 48000, 4800);
    const ratio = rms(lowPassFir(input, 48000, 7200)) / rms(input);
    expect(ratio).toBeLessThan(0.1);
  });
});

describe('downsample (anti-alias)', () => {
  it('같은 레이트면 입력 참조를 그대로 반환', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsample(input, 16000, 16000)).toBe(input);
  });

  it('48k→16k는 길이를 약 1/3로 줄인다', () => {
    const out = downsample(new Float32Array(4800), 48000, 16000);
    expect(out.length).toBe(1600);
  });

  it('나이퀴스트 초과(10kHz) 성분의 앨리어싱을 저역통과로 억제한다', () => {
    // 10kHz는 16k로 데시메이션하면 6kHz로 접힌다(가청 대역 오염).
    const tone = sine(10000, 48000, 4800);
    const naive = resampleLinear(tone, 48000, 16000); // 필터 없음 → 접힘 그대로
    const antiAliased = downsample(tone, 48000, 16000); // 저역통과 후 데시메이션
    expect(rms(antiAliased)).toBeLessThan(rms(naive) * 0.2);
  });

  it('저주파(500Hz)는 다운샘플 후에도 세기를 보존한다', () => {
    const tone = sine(500, 48000, 4800);
    const out = downsample(tone, 48000, 16000);
    expect(rms(out)).toBeGreaterThan(rms(tone) * 0.9);
  });
});

describe('encodeWav', () => {
  it('44바이트 헤더 + 샘플당 2바이트(16bit PCM) 크기', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWav(samples, 16000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + samples.length * 2);
  });

  it('RIFF/WAVE 매직·mono·16bit·샘플레이트를 헤더에 기록', async () => {
    const blob = encodeWav(new Float32Array([0]), 16000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const ascii = (offset: number, len: number): string =>
      String.fromCharCode(...new Uint8Array(buf, offset, len));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(36, 4)).toBe('data');
  });

  it('[-1,1] 밖의 값을 16bit 범위로 클램프한다', async () => {
    const blob = encodeWav(new Float32Array([2, -2]), 16000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0x7fff); // +2 → 최댓값
    expect(view.getInt16(46, true)).toBe(-0x8000); // -2 → 최솟값
  });
});
