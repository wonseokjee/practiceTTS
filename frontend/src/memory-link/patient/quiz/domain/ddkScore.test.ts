// ddkScore.ts — 말운동(DDK) 음절 카운트 테스트

import { describe, expect, it } from 'vitest';
import { countSyllables, isDdkPass } from './ddkScore.js';

/** 피크 n개짜리 합성 포락선 생성 (피크 사이를 0으로 띄움). */
function makeEnvelope(peaks: number): number[] {
  const env: number[] = [];
  for (let i = 0; i < peaks; i += 1) {
    env.push(0, 0, 1, 1, 0, 0); // 충분히 떨어진 상승 에지
  }
  return env;
}

describe('countSyllables', () => {
  it('무음(전부 0)은 0회', () => {
    expect(countSyllables([0, 0, 0, 0])).toBe(0);
  });

  it('분리된 피크 개수를 센다', () => {
    expect(countSyllables(makeEnvelope(5))).toBe(5);
    expect(countSyllables(makeEnvelope(10))).toBe(10);
  });

  it('임계값 아래 잔잔한 잡음은 세지 않는다', () => {
    // 큰 피크 3개 + 작은 잡음(<40%)
    const env = [0, 1, 0, 0.1, 0.2, 0, 1, 0, 0.15, 0, 1, 0];
    expect(countSyllables(env)).toBe(3);
  });

  it('연속 프레임은 한 번으로 묶는다(minGap)', () => {
    // 길게 이어진 상승은 1회
    expect(countSyllables([0, 0, 1, 1, 1, 1, 1, 0])).toBe(1);
  });

  it('최댓값이 무음 수준이면(미세 잡음) 0회 — 과대계측 방지', () => {
    // 최댓값 0.03 < 기본 minPeakLevel 0.05 → 무음 처리
    const noise = [0, 0.02, 0.01, 0.03, 0, 0.02, 0.03, 0.01];
    expect(countSyllables(noise)).toBe(0);
  });
});

describe('isDdkPass', () => {
  it('목표 이상이면 통과', () => {
    expect(isDdkPass(10, 10)).toBe(true);
    expect(isDdkPass(12, 10)).toBe(true);
  });
  it('목표 미만이면 실패', () => {
    expect(isDdkPass(7, 10)).toBe(false);
  });
});
