// QabItemBank.ts — QAB 질문형(단어/문장) 뱅크 테스트

import { describe, expect, it } from 'vitest';
import {
  WORD_CATEGORY,
  buildSpellTiles,
  distractorCountForLevel,
  pickNamingItems,
  pickQabItems,
  pickSentItems,
  pickSpellItems,
  pickWordItems,
  qabItemCount,
} from './QabItemBank.js';

/** 선택지 imageUrl("/…/apple.svg")에서 slug를 뽑는다. */
function slugOf(url: string): string {
  return url.split('/').pop()!.replace(/\.[^.]+$/, '');
}

describe('QabItemBank', () => {
  it('pickQabItems: 요청 개수만큼(한도 내) 반환한다', () => {
    expect(pickQabItems(5)).toHaveLength(5);
  });

  it('pickQabItems: 뱅크보다 많이 요청하면 전체만 반환한다', () => {
    expect(pickQabItems(qabItemCount() + 100)).toHaveLength(qabItemCount());
  });

  it('pickQabItems: word/sentence가 섞여 나온다(충분히 뽑으면 두 종류 모두 등장)', () => {
    const cats = new Set(pickQabItems(qabItemCount()).map((i) => i.category));
    expect(cats.has('word')).toBe(true);
    expect(cats.has('sentence')).toBe(true);
  });

  it('각 문항은 정답 선택지를 정확히 1개 가진다(isCorrect 보존)', () => {
    for (const item of pickQabItems(8)) {
      const correct = item.choices.filter((c) => c.isCorrect);
      expect(correct).toHaveLength(1);
      expect(item.promptText.length).toBeGreaterThan(0);
      expect(item.instruction.length).toBeGreaterThan(0);
      expect(item.choices.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('pickWordItems는 word, pickSentItems는 sentence만 반환한다', () => {
    expect(pickWordItems(3).every((i) => i.category === 'word')).toBe(true);
    expect(pickSentItems(3).every((i) => i.category === 'sentence')).toBe(true);
  });

  it('단어이해: 4보기가 모두 서로 다른 그림/라벨이다(중복 유인지 없음)', () => {
    for (const item of pickWordItems(30)) {
      expect(item.choices).toHaveLength(4);
      const urls = new Set(item.choices.map((c) => c.imageUrl));
      const labels = new Set(item.choices.map((c) => c.label));
      expect(urls.size).toBe(4);
      expect(labels.size).toBe(4);
      expect(item.choices.filter((c) => c.isCorrect)).toHaveLength(1);
    }
  });

  it('단어이해: 큰 범주(동물/음식/사물) 정답은 같은 범주 유인지를 최소 2개 포함한다', () => {
    // 통제된 유인지: 범주만 알고는 못 맞추도록 같은 범주 오답을 우선 배치한다.
    const big = new Set(['animal', 'food', 'object']);
    for (const item of pickWordItems(60)) {
      const correct = item.choices.find((c) => c.isCorrect)!;
      const cat = WORD_CATEGORY[slugOf(correct.imageUrl)] ?? 'object';
      if (!big.has(cat)) continue;
      const sameCatDistractors = item.choices.filter(
        (c) => !c.isCorrect && (WORD_CATEGORY[slugOf(c.imageUrl)] ?? 'object') === cat,
      );
      expect(sameCatDistractors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('0개 요청 시 빈 배열', () => {
    expect(pickQabItems(0)).toEqual([]);
  });

  it('pickNamingItems: 요청 개수만큼, 그림 URL과 정답 이름을 가진다', () => {
    const items = pickNamingItems(3);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.itemId.startsWith('naming_')).toBe(true);
      expect(item.imageUrl.length).toBeGreaterThan(0);
      expect(item.targetWord.length).toBeGreaterThan(0);
      expect(item.instruction.length).toBeGreaterThan(0);
    }
  });

  it('pickNamingItems: 사진이 준비된 단어는 실물 사진을 쓴다', () => {
    // 고령·치매 환자는 선화보다 실물 사진에 더 잘 반응한다(산출 과제).
    // namingPhotos.json에 등록된 단어는 /naming/<slug>.png를 써야 한다.
    // 전체를 뽑아 사과가 반드시 포함되게 한다(무작위 추출이라 일부만 뽑으면 빠질 수 있다).
    const items = pickNamingItems(100);
    const apple = items.find((i) => i.targetWord === '사과');

    // 사과 사진이 등록돼 있으므로 png 경로여야 한다.
    expect(apple?.imageUrl).toBe('/assets/images/naming/apple.png');
  });

  it('pickNamingItems: 사진이 없는 단어는 SVG로 폴백한다', () => {
    // 사진을 20개 다 갖추기 전에도 검사가 깨지면 안 된다.
    // 사진 없는 단어는 단어이해 SVG를 그대로 쓴다.
    const items = pickNamingItems(100);
    const withoutPhoto = items.filter(
      (i) => i.imageUrl.includes('/wordComp/'),
    );

    // 아직 대부분은 SVG 폴백이다.
    expect(withoutPhoto.length).toBeGreaterThan(0);
    for (const item of withoutPhoto) {
      expect(item.imageUrl).toMatch(/\.svg$/);
    }
  });

  it('pickNamingItems: 0개 요청 시 빈 배열', () => {
    expect(pickNamingItems(0)).toEqual([]);
  });

  // ── 레벨별 렌더 난이도 ──────────────────────────────────────
  describe('레벨 파라미터', () => {
    it('레벨이 낮을수록 선택지가 적고 높을수록 많다', () => {
      expect(pickWordItems(5, 1).every((i) => i.choices.length === 2)).toBe(true);
      expect(pickWordItems(5, 2).every((i) => i.choices.length === 3)).toBe(true);
      expect(pickWordItems(5, 3).every((i) => i.choices.length === 4)).toBe(true);
      expect(pickWordItems(5, 4).every((i) => i.choices.length === 4)).toBe(true);
      expect(pickWordItems(5, 5).every((i) => i.choices.length === 5)).toBe(true);
    });

    it('각 레벨에서도 정답은 정확히 1개다', () => {
      for (const lv of [1, 2, 3, 4, 5]) {
        for (const item of pickWordItems(10, lv)) {
          expect(item.choices.filter((c) => c.isCorrect)).toHaveLength(1);
          const urls = new Set(item.choices.map((c) => c.imageUrl));
          expect(urls.size).toBe(item.choices.length); // 중복 유인지 없음
        }
      }
    });

    it('높은 레벨(4)일수록 큰 범주 정답의 같은 범주 오답이 많다(변별↑)', () => {
      const big = new Set(['animal', 'food', 'object']);
      for (const item of pickWordItems(60, 4)) {
        const correct = item.choices.find((c) => c.isCorrect)!;
        const cat = WORD_CATEGORY[slugOf(correct.imageUrl)] ?? 'object';
        if (!big.has(cat)) continue;
        const sameCat = item.choices.filter(
          (c) =>
            !c.isCorrect &&
            (WORD_CATEGORY[slugOf(c.imageUrl)] ?? 'object') === cat,
        );
        // 레벨4 = 오답 3개 전부 같은 범주
        expect(sameCat.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('presentedLevel을 항목에 스탬핑한다', () => {
      expect(pickWordItems(3, 4).every((i) => i.presentedLevel === 4)).toBe(true);
      expect(pickSentItems(3, 2).every((i) => i.presentedLevel === 2)).toBe(true);
      expect(pickNamingItems(3, 5).every((i) => i.presentedLevel === 5)).toBe(true);
    });

    it('레벨 미지정이면 기존 동작(4보기) + presentedLevel undefined', () => {
      const items = pickWordItems(5);
      expect(items.every((i) => i.choices.length === 4)).toBe(true);
      expect(items.every((i) => i.presentedLevel === undefined)).toBe(true);
    });

    it('pickQabItems: 단어/문장 레벨을 각각 스탬핑한다', () => {
      const items = pickQabItems(qabItemCount(), { word: 1, sentence: 5 });
      for (const it of items) {
        expect(it.presentedLevel).toBe(it.category === 'word' ? 1 : 5);
      }
    });
  });
});

// ─── 글자 조합(spell) ─────────────────────────────────────────────
//
// 이 과제는 예전에 보호자 메모 기반으로 만들어져 (a) 기억 회상과 음절 조합이
// 한 문항에 겹치고 (b) 방해 타일이 늘 3개라 적응 레벨링이 붙지 않았다.
// 커리큘럼 단어 풀 기반으로 옮기면서 레벨이 난이도를 정하게 했다.

describe('distractorCountForLevel', () => {
  it('레벨 1~2는 방해 타일이 없다', () => {
    // 가장 쉬운 진입 단계 — 정답 음절 재배열만. 예전 구현엔 이 단계가 없었다.
    expect(distractorCountForLevel(1)).toBe(0);
    expect(distractorCountForLevel(2)).toBe(0);
  });

  it('레벨 3~4는 2개, 5는 4개', () => {
    // 상용 실어증 치료 도구의 등급(방해 글자 0/2/4개)을 그대로 따른다.
    expect(distractorCountForLevel(3)).toBe(2);
    expect(distractorCountForLevel(4)).toBe(2);
    expect(distractorCountForLevel(5)).toBe(4);
  });

  it('레벨 미지정이면 백엔드 콜드스타트(2)와 같은 난이도를 쓴다', () => {
    // 스킬 레벨 조회가 실패하면 level이 undefined로 온다. 이때 임의의 중간값을
    // 쓰면 환자는 방해 2개를 푸는데 서버는 레벨 2(방해 0개)로 기록해 본 난이도와
    // 기록이 어긋난다 — 적응 레벨링의 전제가 깨진다.
    expect(distractorCountForLevel(undefined)).toBe(distractorCountForLevel(2));
    expect(distractorCountForLevel(undefined)).toBe(0);
  });

  it('범위를 벗어난 레벨은 클램프한다', () => {
    expect(distractorCountForLevel(0)).toBe(0);
    expect(distractorCountForLevel(9)).toBe(4);
  });
});

describe('buildSpellTiles', () => {
  const zeroRng = () => 0;

  it('정답 음절을 모두 담고 중복을 보존한다', () => {
    const tiles = buildSpellTiles('바나나', 1, zeroRng);

    expect(tiles).toHaveLength(3);
    expect([...tiles].sort()).toEqual(['나', '나', '바']);
  });

  it('레벨이 낮으면 방해 타일을 섞지 않는다', () => {
    const tiles = buildSpellTiles('바다', 1, zeroRng);

    expect([...tiles].sort()).toEqual(['다', '바']);
  });

  it('레벨이 높으면 방해 타일이 붙는다', () => {
    const tiles = buildSpellTiles('바다', 5, zeroRng);

    expect(tiles).toHaveLength(2 + 4);
    expect(tiles).toEqual(expect.arrayContaining(['바', '다']));
  });

  it('방해 타일은 정답 음절과 겹치지 않는다', () => {
    // 겹치면 "정답인데 오답 타일"이 생겨 환자가 만든 답이 틀리게 채점된다.
    const tiles = buildSpellTiles('가나', 5, zeroRng);
    const extras = [...tiles];
    for (const ch of ['가', '나']) extras.splice(extras.indexOf(ch), 1);

    expect(extras).not.toContain('가');
    expect(extras).not.toContain('나');
  });

  it('타일 총 개수가 상한을 넘지 않는다', () => {
    const tiles = buildSpellTiles('가나다라마바사', 5, zeroRng);

    expect(tiles.length).toBeLessThanOrEqual(8);
  });

  it('빈 목표는 빈 배열', () => {
    expect(buildSpellTiles('', 3, zeroRng)).toEqual([]);
    expect(buildSpellTiles('   ', 3, zeroRng)).toEqual([]);
  });
});

describe('pickSpellItems', () => {
  it('요청 개수만큼 커리큘럼 단어에서 뽑는다', () => {
    const items = pickSpellItems(3, 3);

    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.targetWord.length).toBeGreaterThanOrEqual(2);
      expect(it.tiles).toEqual(
        expect.arrayContaining(Array.from(it.targetWord)),
      );
      expect(it.presentedLevel).toBe(3);
    }
  });

  it('1음절 단어는 제외한다', () => {
    // 조합할 게 없어 과제가 성립하지 않는다.
    const items = pickSpellItems(50, 3);

    expect(items.every((it) => Array.from(it.targetWord).length >= 2)).toBe(true);
  });
});

describe('pickSpellItems — 난이도·중복·반복', () => {
  it('레벨이 낮으면 짧은 단어만 낸다', () => {
    // 방해 타일 수만으로는 난이도가 통제되지 않는다. 4음절+방해0은 2음절+방해0과
    // 전혀 다른 과제라, 길이를 안 묶으면 레벨별 정답률이 어휘 부하와 교란된다.
    const items = pickSpellItems(20, 1);

    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(Array.from(it.targetWord.replace(/\s+/g, ''))).toHaveLength(2);
    }
  });

  it('레벨이 높으면 긴 단어가 나온다', () => {
    const items = pickSpellItems(20, 5);

    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      const n = Array.from(it.targetWord.replace(/\s+/g, '')).length;
      expect(n).toBeGreaterThanOrEqual(3);
    }
  });

  it('제외 목록의 단어는 내지 않는다', () => {
    // 같은 세션의 단어이해가 정답을 TTS로 들려주므로 겹치면 답을 알려준 셈이다.
    const all = pickSpellItems(50, 3).map((it) => it.targetWord);
    const banned = all.slice(0, 3);

    const items = pickSpellItems(50, 3, { exclude: banned });

    for (const b of banned) {
      expect(items.map((it) => it.targetWord)).not.toContain(b);
    }
  });

  it('우선순위 문항을 앞으로 당긴다', () => {
    // 최근에 틀린 문항을 다시 내야 반복 훈련이 성립한다.
    const pool = pickSpellItems(50, 3);
    const target = pool[pool.length - 1];

    const items = pickSpellItems(1, 3, { priority: [target.itemId] });

    expect(items[0].itemId).toBe(target.itemId);
  });

  it('레벨 범위에 맞는 단어가 부족하면 범위를 풀어 문항을 채운다', () => {
    // 문항이 조용히 사라지는 것보다 난이도가 조금 어긋나는 편이 낫다.
    const items = pickSpellItems(200, 5);

    expect(items.length).toBeGreaterThan(10);
  });

  it('count가 0이면 빈 배열', () => {
    expect(pickSpellItems(0, 3)).toEqual([]);
  });
});

