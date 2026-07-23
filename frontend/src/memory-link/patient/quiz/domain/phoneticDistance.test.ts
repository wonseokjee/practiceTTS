import { describe, it, expect } from 'vitest';
import {
  decomposeHangul,
  syllablePhoneticCost,
  phoneticEditDistance,
} from './phoneticDistance.js';

describe('decomposeHangul', () => {
  it('완성형 한글을 초성/중성/종성으로 분해한다', () => {
    expect(decomposeHangul('밥')).toEqual({ cho: 'ㅂ', jung: 'ㅏ', jong: 'ㅂ' });
    expect(decomposeHangul('가')).toEqual({ cho: 'ㄱ', jung: 'ㅏ', jong: '' });
  });

  it('한글이 아니면 null을 반환한다', () => {
    expect(decomposeHangul('a')).toBeNull();
    expect(decomposeHangul('1')).toBeNull();
  });
});

describe('syllablePhoneticCost — 조음 유사 혼동은 부분 비용', () => {
  it('같은 글자는 비용 0', () => {
    expect(syllablePhoneticCost('바', '바')).toBe(0);
  });

  it('양순 파열음 혼동(ㅂ↔ㅍ)은 완전 오류보다 작다', () => {
    const similar = syllablePhoneticCost('바', '파'); // 초성만 다름(같은 그룹)
    const different = syllablePhoneticCost('바', '카'); // 초성 다른 그룹
    expect(similar).toBeGreaterThan(0);
    expect(similar).toBeLessThan(different);
    expect(similar).toBeLessThan(0.2); // 0.3 * 0.4 = 0.12
  });

  it('종성 탈락(밥↔바)은 관대한 부분 비용', () => {
    const cost = syllablePhoneticCost('밥', '바');
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.2); // 0.4 * 0.2 = 0.08
  });

  it('모음 혼동(ㅏ↔ㅓ)은 부분 비용', () => {
    const cost = syllablePhoneticCost('바', '버');
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.2);
  });

  it('한글이 아닌 문자는 단순 불일치(1)', () => {
    expect(syllablePhoneticCost('a', 'b')).toBe(1);
  });
});

describe('phoneticEditDistance — 음소 유사 가중 편집거리', () => {
  it('완전 일치는 0', () => {
    expect(phoneticEditDistance([...'바다'], [...'바다'])).toBe(0);
  });

  it('조음 유사 혼동 단어는 작은 거리(바다↔파다)', () => {
    const d = phoneticEditDistance([...'바다'], [...'파다']);
    expect(d).toBeLessThan(0.34 * 2); // 음절당 평균 0.34 미만
  });

  it('조음 위치가 다른 오류는 큰 거리를 유지(변별력 보존)', () => {
    const d = phoneticEditDistance([...'바다'], [...'하수']);
    expect(d).toBeGreaterThan(0.34 * 2);
  });
});
