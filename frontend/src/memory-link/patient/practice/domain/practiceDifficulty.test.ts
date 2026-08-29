import { describe, expect, it } from 'vitest';
import {
  PRACTICE_MAX_LEVEL,
  PRACTICE_SENTENCE_COUNT,
  practiceLevelFor,
} from './practiceDifficulty.js';

/**
 * 난이도 상한(TODO-113).
 *
 * 검사는 반반 갈리는 지점을 겨누고 연습은 되는 것을 반복시킨다. 같은 뱅크를
 * 써도 뽑는 규칙이 달라야 하는 이유다. 상한이 없을 때 "가볍게 연습하기"
 * 첫 화면에 역행 문장 변별이 나왔다.
 */
describe('practiceLevelFor', () => {
  it('레벨을 모르면 상한값을 쓴다', () => {
    // 아직 레벨을 읽어오는 배선이 없어 지금은 이 경로가 기본이다.
    expect(practiceLevelFor(undefined)).toBe(PRACTICE_MAX_LEVEL);
  });

  it('검사 레벨이 높아도 상한을 넘지 않는다', () => {
    expect(practiceLevelFor(5)).toBe(PRACTICE_MAX_LEVEL);
    expect(practiceLevelFor(3)).toBe(PRACTICE_MAX_LEVEL);
  });

  it('상한보다 낮은 레벨은 그대로 둔다', () => {
    // 상한은 천장이지 바닥이 아니다 — 어려운 쪽만 깎는다.
    expect(practiceLevelFor(1)).toBe(1);
  });

  it('범위 밖 값과 소수는 [1..5]로 정리한 뒤 깎는다', () => {
    expect(practiceLevelFor(0)).toBe(1);
    expect(practiceLevelFor(-7)).toBe(1);
    expect(practiceLevelFor(99)).toBe(PRACTICE_MAX_LEVEL);
    expect(practiceLevelFor(1.4)).toBe(1);
    expect(practiceLevelFor(1.6)).toBe(PRACTICE_MAX_LEVEL);
  });
});

describe('PRACTICE_SENTENCE_COUNT', () => {
  it('문장이해는 기본으로 넣지 않는다', () => {
    // 문장 뱅크 26개가 전부 역할 역행 2지선다다 — 가장 어려운 변별인데
    // 찍으면 50%가 맞는다. 빠뜨린 것이 아니라 뺀 것이라는 표시다.
    expect(PRACTICE_SENTENCE_COUNT).toBe(0);
  });
});
