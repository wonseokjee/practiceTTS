import { buildTiles } from './tile-builder';

/**
 * buildTiles 순수 로직 단위 테스트.
 *
 * 검증 범위:
 *  - 정답 음절이 모두 타일에 포함된다 (중복 음절 보존)
 *  - 오답 음절(distractor)이 추가되어 타일 수가 정답보다 많다
 *  - 공백은 제거 후 음절 분해된다
 *  - 빈 정답이면 빈 배열
 *  - 총 타일 수 상한(8) 준수
 */
describe('buildTiles', () => {
  /** 셔플을 무력화해 결정적으로 검증하기 위한 항등 rng (항상 0). */
  const zeroRng = (): number => 0;

  it('정답의 모든 음절을 타일에 포함한다', () => {
    const tiles = buildTiles('바다', 2, zeroRng);
    expect(tiles).toEqual(expect.arrayContaining(['바', '다']));
  });

  it('중복 음절을 보존한다 (예: "바나나" → 나 2개)', () => {
    const tiles = buildTiles('바나나', 0, zeroRng);
    const naCount = tiles.filter((t) => t === '나').length;
    expect(naCount).toBe(2);
    expect(tiles).toEqual(expect.arrayContaining(['바', '나', '나']));
  });

  it('오답 음절이 추가되어 정답 음절 수보다 타일이 많다', () => {
    const tiles = buildTiles('바다', 3, zeroRng);
    expect(tiles.length).toBe(2 + 3);
  });

  it('오답 음절은 정답 음절과 겹치지 않는다', () => {
    const tiles = buildTiles('바다', 3, zeroRng);
    const distractors = tiles.filter((t) => t !== '바' && t !== '다');
    expect(distractors).not.toContain('바');
    expect(distractors).not.toContain('다');
    expect(distractors.length).toBe(3);
  });

  it('공백은 제거 후 음절 분해한다', () => {
    const tiles = buildTiles('바 다', 0, zeroRng);
    expect(tiles).toEqual(expect.arrayContaining(['바', '다']));
    expect(tiles).not.toContain(' ');
  });

  it('빈 정답이면 빈 배열을 반환한다', () => {
    expect(buildTiles('', 3, zeroRng)).toEqual([]);
    expect(buildTiles('   ', 3, zeroRng)).toEqual([]);
  });

  it('총 타일 수는 상한(8)을 넘지 않는다', () => {
    // 7음절 정답 + distractor 5 요청 → 8개로 캡
    const tiles = buildTiles('가나다라마바사', 5, zeroRng);
    expect(tiles.length).toBeLessThanOrEqual(8);
    expect(tiles.length).toBe(8);
  });
});
