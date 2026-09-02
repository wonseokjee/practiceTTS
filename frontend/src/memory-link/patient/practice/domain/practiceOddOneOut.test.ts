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

const w = (slug: string, category: string | null): MasterWord => ({
  slug,
  label: slug,
  imageUrl: `/${slug}.svg`,
  category,
});

/**
 * 무리로 쓸 수 있는 범주 셋 + **범주 없는 낱말** 넷.
 *
 * 예전엔 넷을 `'object'`라는 범주로 묶고 `UNUSABLE_AS_GROUP`이 그 이름을 걸렀다.
 * 지금은 범주 자체가 `null`이다(E10) — 이름만 범주인 묶음이 검사 쪽에서
 * `foil_kind='semantic'`을 오염시켰기 때문이다.
 */
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
  w('spoon', null),
  w('couch', null),
  w('candle', null),
  w('rock', null),
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

  it('범주 없는 낱말은 무리로 쓰지 않는다', () => {
    // 촛불·소파·숟가락 셋을 놓고 "다른 하나"를 물으면 정답이 하나로 안 정해진다.
    // 어르신이 틀린 게 아니라 문항이 틀린 게 된다.
    const catOf = (id: string) =>
      words.find((x) => x.slug === id)?.category ?? null;

    for (const item of buildOddOneOutItems(words, 3)) {
      const groupCat = catOf(
        item.choices.find((c) => !c.isCorrect)?.choiceId ?? '',
      );
      expect(groupCat).not.toBeNull();
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
  it('그림이(또는 이름대기 사진이) 낱말을 안 보여 주던 장소 넷은 어디에도 안 나온다', () => {
    // 도서관은 책 더미, 수영장은 헤엄치는 사람 — 아이콘이 건물이 아니었다. 실물
    // 사진은 멀쩡해서 이름대기 전용(`namingOnlyWords.json`)으로 옮겼다.
    //
    // 병원은 두 겹으로 부족했다. 아이콘은 십자가 붙은 판이라 건물로 안 보였고,
    // **낱말 풀의 이름대기 사진도 실물이 아니라 3D 일러스트**였다(rawpixel
    // "cute illustration"). 이름대기 전용으로 옮겨도 안 풀리는 문제라, 옮기는
    // 대신 **낱말째** 약국으로 갈았다(2026-09-02) — 진짜 사진(Pixabay, 건물 벽에
    // 걸린 초록 십자가 간판)을 새로 구하고, 아이콘도 같은 화풍으로 새로 그렸다.
    //
    // 우체국·백화점은 같은 날 물렸다 — 건물이기는 한데 *어떤* 건물인지가 안
    // 보였다(유럽식 나팔 표지, 사무실 빌딩). 교회는 종탑 십자가, 공장은 굴뚝,
    // 약국은 초록 십자가로 갈린다.
    const 안보이던것 = ['library', 'pool', 'hospital', 'post_office', 'department_store'];
    const bank = masterWords();
    const slugs = bank.map((w) => w.slug);
    for (const s of 안보이던것) expect(slugs, `${s}이 아직 풀에 있다`).not.toContain(s);
    expect(slugs).toContain('church');
    expect(slugs).toContain('factory');
    expect(slugs).toContain('pharmacy');

    for (const item of buildOddOneOutItems(bank, 99)) {
      for (const c of item.choices) {
        expect(안보이던것, `${c.choiceId}이 무리에 나온다`).not.toContain(c.choiceId);
      }
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
