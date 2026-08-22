import { describe, expect, it } from 'vitest';
import {
  masterWords,
  type MasterWord,
} from '../../quiz/infrastructure/QabItemBank.js';
import {
  ODD_ONE_OUT_REF_PREFIX,
  ODD_ONE_OUT_SIZE,
  buildOddOneOutItems,
} from './practiceOddOneOut.js';

const w = (slug: string, category: string): MasterWord => ({
  slug,
  label: slug,
  imageUrl: `/${slug}.svg`,
  category,
});

/** 무리로 쓸 수 있는 범주 셋 + 잡동사니. */
const words: MasterWord[] = [
  w('dog', 'animal'),
  w('cat', 'animal'),
  w('pig', 'animal'),
  w('bear', 'animal'),
  w('apple', 'food'),
  w('corn', 'food'),
  w('cake', 'food'),
  w('bus', 'vehicle'),
  w('truck', 'vehicle'),
  w('train', 'vehicle'),
  w('spoon', 'object'),
  w('couch', 'object'),
  w('candle', 'object'),
  w('rock', 'object'),
];

describe('buildOddOneOutItems', () => {
  it('셋은 같은 범주, 하나만 다른 범주다', () => {
    const [item] = buildOddOneOutItems(words, 1);

    expect(item.choices).toHaveLength(ODD_ONE_OUT_SIZE);
    const catOf = (id: string) =>
      words.find((x) => x.slug === id)?.category ?? '(없음)';
    const groupCats = item.choices
      .filter((c) => !c.isCorrect)
      .map((c) => catOf(c.choiceId));
    const oddCat = catOf(
      item.choices.find((c) => c.isCorrect)?.choiceId ?? '',
    );

    expect(new Set(groupCats).size).toBe(1);
    expect(groupCats).not.toContain(oddCat);
  });

  it('정답은 정확히 하나다', () => {
    for (const item of buildOddOneOutItems(words, 3)) {
      expect(item.choices.filter((c) => c.isCorrect)).toHaveLength(1);
    }
  });

  it('잡동사니 범주는 무리로 쓰지 않는다', () => {
    // object는 쪼개고 남은 잡동사니 통이라(가방·풍선·양초·돌·열쇠 등 9개)
    // 촛불·소파·숟가락 셋을 놓고 "다른 하나"를 물으면 정답이 하나로 안 정해진다.
    const catOf = (id: string) =>
      words.find((x) => x.slug === id)?.category ?? '(없음)';

    for (const item of buildOddOneOutItems(words, 3)) {
      const groupCat = catOf(
        item.choices.find((c) => !c.isCorrect)?.choiceId ?? '',
      );
      expect(groupCat).not.toBe('object');
    }
  });

  it('한 세션에서 무리 범주가 겹치지 않는다', () => {
    const items = buildOddOneOutItems(words, 3);
    const catOf = (id: string) =>
      words.find((x) => x.slug === id)?.category ?? '(없음)';
    const groupCats = items.map((it) =>
      catOf(it.choices.find((c) => !c.isCorrect)?.choiceId ?? ''),
    );

    // 동물 문항이 연달아 셋 나오면 같은 과제를 세 번 하는 것과 다르지 않다.
    expect(new Set(groupCats).size).toBe(groupCats.length);
  });

  it('item_ref에 접두사를 붙이고 세션 안에서 겹치지 않는다', () => {
    const items = buildOddOneOutItems(words, 3);

    for (const it of items) {
      expect(it.itemId.startsWith(ODD_ONE_OUT_REF_PREFIX)).toBe(true);
    }
    expect(new Set(items.map((it) => it.itemId)).size).toBe(items.length);
  });

  it('재료가 모자라면 만들 수 있는 만큼만 준다', () => {
    // 빈 문항을 세우느니 짧은 세션이 낫다.
    const thin = [w('dog', 'animal'), w('cat', 'animal'), w('pig', 'animal')];

    expect(buildOddOneOutItems(thin, 3)).toHaveLength(0);
    expect(buildOddOneOutItems(words, 99).length).toBeLessThanOrEqual(3);
  });

  it('0개를 요청하면 빈 배열이다', () => {
    expect(buildOddOneOutItems(words, 0)).toEqual([]);
  });

  /**
   * 실제 뱅크로 한 번 돌려본다.
   *
   * 위 테스트들은 손으로 만든 낱말 목록을 쓴다. 진짜 데이터의 범주 분포는
   * food 15 / animal 12 / object 9 / vehicle 7 / place 6 / body 6 /
   * clothing 5 / person 4 / plant 4 / stationery 4 / furniture 3 /
   * instrument 3 / appliance 3 / kitchen 3 / bathroom 3 / tool 3이고,
   * 무리로 쓸 수 있는 범주는 object를 뺀 15개다(2026-08-22, 낱말 90개).
   * 늘리는 방법은 `docs/ASSETS-NEEDED.md`에 있다.
   */
  it('그림이 장소로 안 보이는 도서관·수영장은 무리에 넣지 않는다', () => {
    // 태그는 place가 맞지만 도서관은 책 더미로, 수영장은 헤엄치는 사람으로
    // 그려져 있다. 셋을 늘어놓으면 화면에는 건물·사람·책이 보인다.
    // place 범주 자체는 병원·집·학교·은행으로 선다 — 문제는 이 두 그림이다.
    const bank = masterWords();

    for (const item of buildOddOneOutItems(bank, 99)) {
      const group = item.choices.filter((c) => !c.isCorrect);
      expect(group.map((c) => c.choiceId)).not.toContain('library');
      expect(group.map((c) => c.choiceId)).not.toContain('pool');
    }
  });

  it('실제 낱말 풀에서 무리 범주가 15개 선다', () => {
    // object 하나를 뺀 나머지 전부. 이 수가 곧 이 양식의 상한이다 —
    // 세션당 2문항을 범주 안 겹치게 뽑으므로 매일 해도 한참 안 겹친다.
    const items = buildOddOneOutItems(masterWords(), 99);

    expect(items).toHaveLength(15);
  });

  it('실제 낱말 풀에서도 기본 개수만큼 만들어진다', () => {
    const items = buildOddOneOutItems(masterWords(), 2);

    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.choices).toHaveLength(ODD_ONE_OUT_SIZE);
      expect(it.choices.filter((c) => c.isCorrect)).toHaveLength(1);
      // 그림이 실제로 붙어 있어야 화면이 빈 칸으로 서지 않는다.
      expect(it.choices.every((c) => c.imageUrl.length > 0)).toBe(true);
    }
  });
});
