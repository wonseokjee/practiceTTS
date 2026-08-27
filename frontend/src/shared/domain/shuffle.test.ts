import { describe, expect, it } from 'vitest';
import { shuffle } from './shuffle.js';

describe('shuffle', () => {
  it('원본을 바꾸지 않는다', () => {
    const src = [1, 2, 3, 4];
    const out = shuffle(src);
    expect(src).toEqual([1, 2, 3, 4]);
    expect(out).not.toBe(src);
  });

  it('원소를 잃지도 더하지도 않는다', () => {
    const src = Array.from({ length: 50 }, (_, i) => i);
    expect([...shuffle(src)].sort((a, b) => a - b)).toEqual(src);
  });

  it('빈 배열과 한 원소를 그대로 돌려준다', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['a'])).toEqual(['a']);
  });

  it('난수원을 주면 결정적이다', () => {
    // 이게 이 유틸을 하나로 모은 이유다. 예전에는 일곱 복사본 중 하나만 rng를
    // 받아, 나머지 코드 경로는 결정적으로 검증할 수 없었다.
    const 항상0 = () => 0;
    expect(shuffle([1, 2, 3, 4], 항상0)).toEqual(shuffle([1, 2, 3, 4], 항상0));
  });

  it('마지막 자리도 섞임 대상이다 — j <= i에서 뽑는다', () => {
    // `j < i`로 쓰면 마지막 원소가 제자리에 남을 확률이 0이 되어 분포가 치우친다.
    // rng를 1에 가깝게 고정하면 각 단계에서 j === i가 되어 순서가 보존돼야 한다.
    const 항상마지막 = () => 0.999999;
    expect(shuffle([1, 2, 3, 4, 5], 항상마지막)).toEqual([1, 2, 3, 4, 5]);
  });
});
