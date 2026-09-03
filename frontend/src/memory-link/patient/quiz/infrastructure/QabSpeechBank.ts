// QAB 발화 검사 문항 뱅크 (프론트 정적 데이터)
//
// 검사6 따라말하기 / 검사7 소리 내어 읽기 / 검사8 말운동(DDK) 문항을
// qabSpeechStimuli.json에서 무작위 추출한다. 채점은 모두 프론트 로컬.

import stimuliData from '../../../../assets/data/qabSpeechStimuli.json';
import { shuffle } from '../../../../shared/domain/shuffle.js';
import type { DdkKind } from '../domain/difficultyRules.js';
import {
  ddkSpecForLevel,
  readingRangeForLevel,
  repeatSpecForLevel,
  syllableCount,
  wordCount,
} from '../domain/difficultyRules.js';
import type {
  QabDdkItem,
  QabReadingItem,
  QabRepeatItem,
} from '../domain/MixedQuiz.js';

interface RawDdk {
  syllable: string;
  label: string;
}
interface RawStimuli {
  repeatWords: string[];
  repeatSentences: string[];
  readingSentences: string[];
  ddk: RawDdk[];
}

const STIMULI = stimuliData as RawStimuli;

/**
 * 요청한 범위로 거르되, 모자라면 범위를 풀어 문항이 조용히 사라지지 않게 한다.
 * (난이도가 조금 어긋나는 편이 세션이 비는 것보다 낫다 — QabItemBank와 같은 원칙.)
 */
/**
 * 레벨 밴드에 맞는 후보를 고르되, 모자라면 전체 풀로 되돌린다.
 *
 * 되돌림 자체는 옳다 — 문항이 조용히 사라지는 것보다 난이도가 조금 어긋나는 편이
 * 낫다. 문제는 그게 **조용했다**는 것이다. 그렇게 나온 문항의 `presentedLevel`은
 * 실제 난이도를 뜻하지 않는데, 집계는 그 사실을 모른 채 레벨별로 센다.
 * `fellBack`을 함께 돌려줘 호출부가 문항에 표시하게 한다(D3).
 *
 * **exclude는 겹침 방지(다양성)다** — QabItemBank의 문장이해와 같은 2단
 * 되돌리기를 쓴다. 밴드 안에서 exclude를 지키며 채울 수 있으면 그대로,
 * 안 되면 먼저 exclude만 풀어 **같은 레벨 안에서** 채우고(`fellBack` 안 붙음),
 * 그래도 모자라면 레벨째 되돌린다. `exclude`·`getId`를 안 넘기면(ddk) 예전과
 * 완전히 같다.
 */
function withinOrFallback<T>(
  pool: readonly T[],
  inRange: (item: T) => boolean,
  want: number,
  options?: { exclude?: ReadonlySet<string>; getId?: (item: T) => string },
): { items: T[]; fellBack: boolean } {
  const eligible = pool.filter(inRange);
  const { exclude, getId } = options ?? {};
  if (exclude && getId) {
    const fresh = eligible.filter((it) => !exclude.has(getId(it)));
    if (fresh.length >= want) return { items: fresh, fellBack: false };
  }
  return eligible.length >= want
    ? { items: [...eligible], fellBack: false }
    : { items: [...pool], fellBack: true };
}

/** 밴드 밖에서 온 문항에 표시를 남긴다. 값이 false면 필드를 만들지 않는다. */
function markFallback<T extends { bandFallback?: boolean }>(
  items: T[],
  fellBack: boolean,
): T[] {
  return fellBack ? items.map((it) => ({ ...it, bandFallback: true })) : items;
}

const REPEAT_INSTRUCTION = '들려주는 말을 잘 듣고 따라 말해주세요';
const READING_INSTRUCTION = '아래 문장을 소리 내어 읽어주세요';
const DDK_INSTRUCTION = '아래 소리를 최대한 빠르고 또렷하게 반복해서 말해주세요';


/**
 * `pickRepeatItems`·`pickReadingItems`가 같이 쓰는 옵션.
 *
 * `QabItemBank.PickQabOptions`와 같은 개념(세션을 넘는 최근 문항 제외, 다양성이
 * 목적)이다 — spell의 재출제(priority)와는 반대다. 여기 둘은 원래 재출제
 * 장치가 없던 순수 무작위 검사였고, 정답률이 word·sentence·naming과 같은
 * 레벨·추세로 나가므로 같은 처방을 쓴다(TODOS "QAB 세션" 절, 2026-09-02).
 */
export interface PickSpeechOptions {
  exclude?: ReadonlySet<string>;
}

/**
 * 따라말하기 문항 추출. 레벨이 종류(단어/문장)와 길이를 함께 정한다.
 * level 미지정 시 콜드스타트(2) — 2~3음절 단어.
 */
export function pickRepeatItems(
  count: number,
  level?: number,
  options?: PickSpeechOptions,
): QabRepeatItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  const spec = repeatSpecForLevel(level);

  const words: QabRepeatItem[] = STIMULI.repeatWords.map((text, i) => ({
    itemId: `repeat_w${i}`,
    category: 'word',
    text,
    instruction: REPEAT_INSTRUCTION,
    presentedLevel: level,
  }));
  const sentences: QabRepeatItem[] = STIMULI.repeatSentences.map((text, i) => ({
    itemId: `repeat_s${i}`,
    category: 'sentence',
    text,
    instruction: REPEAT_INSTRUCTION,
    presentedLevel: level,
  }));

  // mixed는 두 풀을 합친 뒤 각자의 기준으로 거른다 — 단어는 음절, 문장은 어절.
  const pool =
    spec.kind === 'word'
      ? words
      : spec.kind === 'sentence'
        ? sentences
        : [...words, ...sentences];
  const inRange = (it: QabRepeatItem): boolean => {
    const n =
      it.category === 'word' ? syllableCount(it.text) : wordCount(it.text);
    return n >= spec.min && n <= spec.max;
  };

  const picked = withinOrFallback(pool, inRange, want, {
    exclude: options?.exclude,
    getId: (it) => it.itemId,
  });
  return markFallback(shuffle(picked.items).slice(0, want), picked.fellBack);
}

/** 소리 내어 읽기 문항 추출. 레벨이 문장 길이를 정한다. */
export function pickReadingItems(
  count: number,
  level?: number,
  options?: PickSpeechOptions,
): QabReadingItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  const { min, max } = readingRangeForLevel(level);

  const items: QabReadingItem[] = STIMULI.readingSentences.map((text, i) => ({
    itemId: `reading_${i}`,
    text,
    instruction: READING_INSTRUCTION,
    presentedLevel: level,
  }));
  const inRange = (it: QabReadingItem): boolean => {
    const n = wordCount(it.text);
    return n >= min && n <= max;
  };

  const picked = withinOrFallback(items, inRange, want, {
    exclude: options?.exclude,
    getId: (it) => it.itemId,
  });
  return markFallback(shuffle(picked.items).slice(0, want), picked.fellBack);
}

/** 자극의 밴드 — 음절 수가 곧 조음 위치 전환 수 + 1이다. */
function ddkKindOf(syllable: string): DdkKind {
  const n = syllableCount(syllable);
  if (n === 1) return 'amr';
  return n === 2 ? 'smr2' : 'smr3';
}

/** 말운동(DDK) 문항 추출. 레벨이 밴드와 반복 요구량을 함께 정한다. */
export function pickDdkItems(count: number, level?: number): QabDdkItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  const spec = ddkSpecForLevel(level);

  // 목표 횟수는 자극 데이터가 아니라 레벨이 정한다 — 같은 '퍼'라도 레벨마다
  // 요구가 달라야 5단계가 5단계로 작동한다.
  const items: QabDdkItem[] = STIMULI.ddk.map((d, i) => ({
    itemId: `ddk_${i}`,
    syllable: d.syllable,
    label: d.label,
    targetCount: spec.targetCount,
    instruction: DDK_INSTRUCTION,
    presentedLevel: level,
  }));
  const inRange = (it: QabDdkItem): boolean =>
    ddkKindOf(it.syllable) === spec.kind;

  const picked = withinOrFallback(items, inRange, want);
  return markFallback(shuffle(picked.items).slice(0, want), picked.fellBack);
}

// 난이도 규칙의 집은 domain/difficultyRules.ts다(D2).
export {
  ddkSpecForLevel,
  readingRangeForLevel,
  repeatSpecForLevel,
} from '../domain/difficultyRules.js';
export type { DdkKind, DdkSpec } from '../domain/difficultyRules.js';
