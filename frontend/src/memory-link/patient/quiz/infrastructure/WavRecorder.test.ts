import { describe, it, expect } from 'vitest';
import { encodeWav, resampleLinear, mergeChunks } from './WavRecorder.js';

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
