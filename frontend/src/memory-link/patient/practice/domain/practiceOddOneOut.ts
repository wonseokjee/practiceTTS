// 무리에서 빼기 — 셋은 같은 무리, 하나만 다르다
//
// 그림고르기·낱말고르기가 "이것과 저것 중 무엇이냐"를 묻는다면, 이 양식은
// **범주로 묶는 능력**을 쓴다. 실어증에서 낱말 인출이 막혀도 의미 범주 지식은
// 남아 있는 경우가 많아, 되는 것으로 반복하기 좋은 과제다.
//
// Tier 0 — 소리도 새 그림도 필요 없다. 범주 태그가 이미 붙어 있어 조합만
// 만들면 된다.

import type { MasterWord } from '../../quiz/infrastructure/QabItemBank.js';
import { shuffle } from '../../../../shared/domain/shuffle.js';

export interface PracticeOddOneOutOption {
  choiceId: string;
  label: string;
  imageUrl: string;
  isCorrect: boolean;
}

export interface PracticeOddOneOutItem {
  /** `ooo_` 접두사 — 이유는 practiceWordChoice.ts의 itemId 주석 참고. */
  itemId: string;
  instruction: string;
  choices: PracticeOddOneOutOption[];
}

export const ODD_ONE_OUT_INSTRUCTION = '다른 하나를 골라주세요';
export const ODD_ONE_OUT_REF_PREFIX = 'ooo_';

/** 한 문항의 선택지 수 — 같은 무리 3 + 다른 것 1. */
export const ODD_ONE_OUT_SIZE = 4;

/**
 * 무리 쪽으로 쓸 수 없는 범주.
 *
 * `object` — 남은 잡동사니 통이다. 2026-08-22에 34개를 옷·문구·가구·악기·가전·
 * 주방·욕실·연장으로 쪼개고 나서도 아홉이 남았다(가방·풍선·바구니·양초·우체통·
 * 돌·우산·열쇠·시계). 이 아홉은 서로 한 무리가 아니라서, 셋을 놓고 "다른 하나"를
 * 물으면 정답이 하나로 정해지지 않는다. 어르신이 틀린 게 아니라 문항이 틀린 게 된다.
 *
 * 반대로 **다른 하나**로는 전부 쓸 수 있다. 동물 셋 사이의 열쇠는 명확하다.
 *
 * 무리로 쓸 수 있는 범주 15개: animal 12 · food 15 · vehicle 7 · place 6 ·
 * body 6 · clothing 5 · person 4 · plant 4 · stationery 4 · furniture 3 ·
 * instrument 3 · appliance 3 · kitchen 3 · bathroom 3 · tool 3.
 *
 * 예전에는 여기에 `'object'`가 있었다. 지금은 그 아홉 낱말의 범주 자체가 `null`이라
 * (E10 — 이름만 범주인 묶음이 `foil_kind='semantic'`을 오염시켰다) 아래에서 범주
 * 없는 낱말을 걸러내는 것으로 같은 일이 된다. 목록은 비었지만 남겨 둔다 —
 * "이 범주는 무리로 못 쓴다"가 또 필요해질 자리다.
 */
const UNUSABLE_AS_GROUP = new Set<string>();

/**
 * 무리 쪽으로 쓸 수 없는 **낱말**. **지금은 비어 있다.**
 *
 * 범주가 아니라 그림이 문제인 경우를 위한 자리다. 도서관(책 더미)과 수영장
 * (헤엄치는 사람) 둘이 여기 있었다 — 태그는 `place`가 맞는데 셋을 늘어놓으면
 * 화면에는 건물·사람·책이 보여서, 한 무리라는 것을 그림만으로는 알 수 없었다.
 * 낱말을 읽을 수 있어야만 풀리는 문항이 되고 그건 이 양식이 재려던 능력이 아니다.
 *
 * TODO-115에서 **낱말을 바꿔서** 닫았다(2026-09-02). 두 낱말은 사진이 멀쩡하므로
 * 이름대기 전용으로 옮기고(`namingOnlyWords.json`), 건물이 보이는 우체국·백화점을
 * 낱말 풀에 넣었다. 이제 `place` 여섯이 다 건물이라 목록이 필요 없다.
 *
 * 목록은 남겨 둔다 — 그림이 낱말을 안 보여 주는 일은 또 생긴다.
 */
const UNUSABLE_AS_GROUP_WORDS = new Set<string>();


function toOption(word: MasterWord, isCorrect: boolean): PracticeOddOneOutOption {
  return {
    choiceId: word.slug,
    label: word.label,
    imageUrl: word.imageUrl,
    isCorrect,
  };
}

/**
 * 무리에서 빼기 문항을 count개 만든다.
 *
 * 한 세션 안에서 **무리 범주가 겹치지 않게** 한다. 동물 문항이 연달아 셋 나오면
 * 같은 과제를 세 번 하는 것과 다르지 않다.
 *
 * 재료가 모자라면 만들 수 있는 만큼만 돌려준다 — 빈 문항을 세우느니 짧은
 * 세션이 낫다.
 */
export function buildOddOneOutItems(
  words: readonly MasterWord[],
  count: number,
): PracticeOddOneOutItem[] {
  if (count <= 0) return [];

  // 무리 후보를 먼저 거른 뒤에 센다. 못 쓰는 낱말을 세고 나서 빼면 셋이
  // 있는 줄 알고 골랐다가 둘만 남는 범주가 생긴다.
  const byCategory = new Map<string, MasterWord[]>();
  for (const w of words) {
    if (UNUSABLE_AS_GROUP_WORDS.has(w.slug)) continue;
    // 범주 없는 낱말(가방·풍선·돌…)은 무리를 못 만든다. 셋을 놓고 "다른 하나"를
    // 물으면 정답이 하나로 안 정해진다.
    if (w.category === null) continue;
    const bucket = byCategory.get(w.category);
    if (bucket) bucket.push(w);
    else byCategory.set(w.category, [w]);
  }

  const groupCategories = shuffle(
    [...byCategory.entries()]
      .filter(
        ([cat, ws]) =>
          !UNUSABLE_AS_GROUP.has(cat) && ws.length >= ODD_ONE_OUT_SIZE - 1,
      )
      .map(([cat]) => cat),
  );

  const items: PracticeOddOneOutItem[] = [];
  for (const category of groupCategories) {
    if (items.length >= count) break;

    const group = shuffle(byCategory.get(category) ?? []).slice(
      0,
      ODD_ONE_OUT_SIZE - 1,
    );
    const outsiders = words.filter((w) => w.category !== category);
    if (outsiders.length === 0) continue;
    const odd = shuffle(outsiders)[0];

    items.push({
      // 다른 하나 + 무리 범주면 한 세션 안에서 유일하다(무리 범주가 안 겹치므로).
      itemId: `${ODD_ONE_OUT_REF_PREFIX}${odd.slug}_${category}`,
      instruction: ODD_ONE_OUT_INSTRUCTION,
      choices: shuffle([
        ...group.map((w) => toOption(w, false)),
        toOption(odd, true),
      ]),
    });
  }

  return items;
}
