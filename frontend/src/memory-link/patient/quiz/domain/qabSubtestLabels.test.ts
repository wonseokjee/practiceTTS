import { describe, expect, it } from 'vitest';
import { QAB_SUBTESTS } from '../../../../../../backend/src/quiz/constants/qab-subtest';
import {
  LEVELED_SUBTESTS,
  NON_LEVELED_SUBTESTS,
  QAB_SUBTEST_LABELS,
  QAB_SUBTEST_ORDER,
  subtestLabel,
} from './qabSubtestLabels.js';

/**
 * 라벨 표는 타입이 전수를 강제하지만, **배열은 못 한다.**
 * 2026-08-17에 spell을 추가하면서 표시 순서와 눈높이 목록을 빠뜨려도 tsc가
 * 통과했고, 보호자 화면에서 항목이 안 보이거나 맨 앞으로 튀었다. 여기서 막는다.
 */
describe('QAB 검사 라벨', () => {
  it('표시 순서가 모든 검사를 빠짐없이 담는다', () => {
    // 누락되면 indexOf가 -1이라 목록 맨 앞으로 튄다.
    const labeled = Object.keys(QAB_SUBTEST_LABELS).sort();
    expect([...QAB_SUBTEST_ORDER].sort()).toEqual(labeled);
  });

  it('순서 배열에 중복이 없다', () => {
    expect(new Set(QAB_SUBTEST_ORDER).size).toBe(QAB_SUBTEST_ORDER.length);
  });

  it('레벨 있는 검사 + 없는 검사 = 전체', () => {
    // 새 검사를 추가하고 어느 쪽에도 안 넣으면 눈높이 카드에서 조용히 사라진다.
    expect([...LEVELED_SUBTESTS, ...NON_LEVELED_SUBTESTS].sort()).toEqual(
      [...QAB_SUBTEST_ORDER].sort(),
    );
  });

  it('모든 라벨이 한글이고 비어 있지 않다', () => {
    for (const [key, label] of Object.entries(QAB_SUBTEST_LABELS)) {
      expect(label.trim().length, `${key} 라벨이 비었다`).toBeGreaterThan(0);
      expect(label, `${key}가 영문 키 그대로 노출된다`).not.toBe(key);
    }
  });

  it('알 수 없는 값이 와도 화면이 깨지지 않는다', () => {
    expect(subtestLabel('unknown_future_subtest')).toBe('unknown_future_subtest');
  });
});

describe('백엔드 상수와의 동기화', () => {
  it('백엔드 QAB_SUBTESTS와 프론트 라벨 키가 일치한다', () => {
    // 백엔드에 검사를 추가하고 프론트 라벨을 안 넣으면 보호자에게 영문 키가 뜬다.
    // 반대로 프론트에만 있으면 서버가 그 결과를 거부한다.
    expect([...QAB_SUBTESTS].sort()).toEqual(
      Object.keys(QAB_SUBTEST_LABELS).sort(),
    );
  });
});
