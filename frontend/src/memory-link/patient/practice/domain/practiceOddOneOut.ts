// 무리에서 빼기 — 셋은 같은 무리, 하나만 다르다
//
// 그림고르기·낱말고르기가 "이것과 저것 중 무엇이냐"를 묻는다면, 이 양식은
// **범주로 묶는 능력**을 쓴다. 실어증에서 낱말 인출이 막혀도 의미 범주 지식은
// 남아 있는 경우가 많아, 되는 것으로 반복하기 좋은 과제다.
//
// Tier 0 — 소리도 새 그림도 필요 없다. 범주 태그가 이미 붙어 있어 조합만
// 만들면 된다.

import type { MasterWord } from '../../quiz/infrastructure/QabItemBank.js';

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
 * `object` — 77개 중 34개가 몰린 잡동사니 통이다. 촛불·소파·숟가락을 셋 모아
 * 놓고 "다른 하나"를 물으면 정답이 하나로 정해지지 않는다. 어르신이 틀린 게
 * 아니라 문항이 틀린 것이 된다.
 *
 * `place` — 태그는 맞지만 **그림이 범주를 못 나른다.** 도서관은 책 더미로,
 * 수영장은 헤엄치는 사람으로 그려져 있다. 병원·수영장·도서관을 늘어놓으면
 * 화면에는 건물·사람·책이 보이고, 셋이 한 무리라는 것을 그림만으로 알 수
 * 없다(2026-08-21 브라우저 확인). 낱말을 읽을 수 있어야만 풀리는 문항이
 * 되는데, 그건 이 양식이 재려던 능력이 아니다. 장소를 장소로 그린 그림이
 * 들어오면 푼다(TODO-115).
 *
 * `body`(0개)·`person`(1개)은 애초에 셋을 못 채워 아래 길이 조건에서 걸린다.
 *
 * 반대로 **다른 하나**로는 전부 쓸 수 있다. 동물 셋 사이의 숟가락은 명확하다.
 *
 * 남는 무리 범주: plant 4 · vehicle 7 · animal 12 · food 15.
 *
 * 넷을 열다섯으로 늘리는 방법(그릴 그림 0장)은 `docs/ASSETS-NEEDED.md`에 있다.
 */
const UNUSABLE_AS_GROUP = new Set(['object', 'place']);

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

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

  const byCategory = new Map<string, MasterWord[]>();
  for (const w of words) {
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
