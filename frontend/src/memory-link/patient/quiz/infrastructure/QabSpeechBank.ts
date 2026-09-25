// QAB 발화 검사 문항 뱅크 (프론트 정적 데이터)
//
// 검사6 따라말하기 / 검사7 소리 내어 읽기 / 검사8 말운동(DDK) 문항을
// 자극 JSON에서 무작위 추출한다. 채점은 모두 프론트 로컬.
//
// **로케일별 뱅크다**(영어판 M2 ②). 한국어 qabSpeechStimuli.json, 영어
// qabSpeechStimuli.en-US.json. 세션이 고정한 로케일(`options.locale`)로 고른다.
//
//   - 영어 문항 id에는 `<로케일>:` 접두를 붙인다(`en-US:repeat_w0`). 위치 기반 id를
//     그대로 쓰면 영어·한국어 `repeat_w0`이 같은 문자열이 되어 최근 문항 제외와
//     문항 분석(item_ref로 묶음)에서 두 언어 문항이 한 문항으로 합쳐진다.
//     한국어 id는 저장된 결과와 맞춰 그대로 둔다.
//   - **다른 언어로 채우지 않는다.** 영어 풀이 모자라면(콘텐츠를 채우는 중이다)
//     밴드 되돌림은 영어 풀 안에서만 일어나고, 그래도 비면 빈 결과다. 한국어
//     문항이 영어 세션에 섞이면 그 회차 점수는 두 모집단을 합친 값이 된다.
//   - 영어 낱말은 저작 시 CMUdict로 채운 `syllables`를 쓴다 — 영어는 글자 수가
//     음절 수가 아니다. 문장은 단어 수(공백 기준).

import koStimuli from '../../../../assets/data/qabSpeechStimuli.json';
import { languageOf } from '../../../../shared/domain/locale.js';
import { shuffle } from '../../../../shared/domain/shuffle.js';
import type { DdkKind, LengthRange } from '../domain/difficultyRules.js';
import {
  ddkSpecForLevel,
  readingBandForLevel,
  repeatBandsForLevel,
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
interface KoStimuli {
  repeatWords: string[];
  repeatSentences: string[];
  readingSentences: string[];
  ddk: RawDdk[];
}
interface EnStimulus {
  text: string;
  syllables: number;
}
interface EnStimuli {
  locale: string;
  repeatWords: EnStimulus[];
  repeatSentences: EnStimulus[];
  readingSentences: EnStimulus[];
  ddk: RawDdk[];
}

/** 한 로케일의 자극과 그 로케일의 지시문. */
interface SpeechBank {
  /** 문항 id 앞에 붙는다. 한국어는 빈 문자열(저장된 결과와 호환). */
  idPrefix: string;
  words: EnStimulus[];
  repeatSentences: string[];
  readingSentences: string[];
  ddk: RawDdk[];
  instructions: { repeat: string; reading: string; ddk: string };
}

const KO = koStimuli as KoStimuli;

const KO_BANK: SpeechBank = {
  idPrefix: '',
  words: KO.repeatWords.map((text) => ({ text, syllables: syllableCount(text) })),
  repeatSentences: KO.repeatSentences,
  readingSentences: KO.readingSentences,
  ddk: KO.ddk,
  instructions: {
    repeat: '들려주는 말을 잘 듣고 따라 말해주세요',
    reading: '아래 문장을 소리 내어 읽어주세요',
    ddk: '아래 소리를 최대한 빠르고 또렷하게 반복해서 말해주세요',
  },
};

// 지시문은 i18n 1-2(문자열 추출) 때 환자 네임스페이스로 옮긴다 — 영어 문구는
// 그때 톤(계획서 Q11, elderspeak 회피)과 함께 다시 본다.
function buildEnBank(en: EnStimuli): SpeechBank {
  return {
    idPrefix: `${en.locale}:`,
    words: en.repeatWords,
    repeatSentences: en.repeatSentences.map((s) => s.text),
    readingSentences: en.readingSentences.map((s) => s.text),
    ddk: en.ddk,
    instructions: {
      repeat: 'Listen carefully, then say it back',
      reading: 'Read this sentence out loud',
      ddk: 'Say this sound again and again, as fast and clearly as you can',
    },
  };
}

const isEnglish = (locale?: string): boolean =>
  locale !== undefined && languageOf(locale) === 'en';

/**
 * 영어 자극은 메인 번들에 넣지 않고 세션이 영어로 시작할 때 처음 한 번 불러온다
 * (한국어만 쓰는 사용자가 영어 문장 55KB를 받지 않게). pick*는 동기 함수라 **세션이
 * 뽑기 전에 이걸 await해야 한다.** 실패하면 던져서 세션의 재시도 경로로 넘어간다.
 */
let enBank: SpeechBank | null = null;
export async function ensureSpeechBank(locale?: string): Promise<void> {
  if (!isEnglish(locale) || enBank !== null) return;
  const mod = await import('../../../../assets/data/qabSpeechStimuli.en-US.json');
  enBank = buildEnBank(mod.default as EnStimuli);
}

function bankFor(locale?: string): SpeechBank {
  if (!isEnglish(locale)) return KO_BANK;
  // 영어 세션인데 안 불러왔으면 한국어 문항으로 대신하지 않고 터뜨린다.
  if (enBank === null) {
    throw new Error('영어 자극이 아직 로드되지 않았다 — ensureSpeechBank를 먼저 await');
  }
  return enBank;
}

function within(n: number, range: LengthRange | null): boolean {
  return range !== null && n >= range.min && n <= range.max;
}

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
 * 완전히 같다. 풀은 한 로케일의 풀이다 — 되돌림이 언어를 넘지 않는다.
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

/**
 * `pickRepeatItems`·`pickReadingItems`·`pickDdkItems`가 같이 쓰는 옵션.
 *
 * `exclude`는 `QabItemBank.PickQabOptions`와 같은 개념(세션을 넘는 최근 문항 제외,
 * 다양성이 목적)이다 — spell의 재출제(priority)와는 반대다. 여기 둘은 원래 재출제
 * 장치가 없던 순수 무작위 검사였고, 정답률이 word·sentence·naming과 같은
 * 레벨·추세로 나가므로 같은 처방을 쓴다(TODOS "QAB 세션" 절, 2026-09-02).
 *
 * `locale`은 세션이 시작할 때 고정한 환자 로케일이다. 안 주면 한국어.
 */
export interface PickSpeechOptions {
  exclude?: ReadonlySet<string>;
  locale?: string;
}

/** 길이(낱말은 음절, 문장은 단어·어절)를 들고 다니는 후보. */
interface Candidate<T> {
  item: T;
  length: number;
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
  const bank = bankFor(options?.locale);
  const bands = repeatBandsForLevel(level, options?.locale);

  const words: Candidate<QabRepeatItem>[] = bank.words.map((w, i) => ({
    item: {
      itemId: `${bank.idPrefix}repeat_w${i}`,
      category: 'word',
      text: w.text,
      instruction: bank.instructions.repeat,
      presentedLevel: level,
    },
    length: w.syllables,
  }));
  const sentences: Candidate<QabRepeatItem>[] = bank.repeatSentences.map(
    (text, i) => ({
      item: {
        itemId: `${bank.idPrefix}repeat_s${i}`,
        category: 'sentence',
        text,
        instruction: bank.instructions.repeat,
        presentedLevel: level,
      },
      length: wordCount(text),
    }),
  );

  // mixed는 두 풀을 합친 뒤 각자의 기준으로 거른다 — 단어는 음절, 문장은 어절·단어.
  const pool =
    bands.kind === 'word'
      ? words
      : bands.kind === 'sentence'
        ? sentences
        : [...words, ...sentences];
  const inRange = (c: Candidate<QabRepeatItem>): boolean =>
    within(c.length, c.item.category === 'word' ? bands.word : bands.sentence);

  const picked = withinOrFallback(pool, inRange, want, {
    exclude: options?.exclude,
    getId: (c) => c.item.itemId,
  });
  return markFallback(
    shuffle(picked.items)
      .slice(0, want)
      .map((c) => c.item),
    picked.fellBack,
  );
}

/** 소리 내어 읽기 문항 추출. 레벨이 문장 길이를 정한다. */
export function pickReadingItems(
  count: number,
  level?: number,
  options?: PickSpeechOptions,
): QabReadingItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  const bank = bankFor(options?.locale);
  const band = readingBandForLevel(level, options?.locale);

  const items: QabReadingItem[] = bank.readingSentences.map((text, i) => ({
    itemId: `${bank.idPrefix}reading_${i}`,
    text,
    instruction: bank.instructions.reading,
    presentedLevel: level,
  }));
  const inRange = (it: QabReadingItem): boolean => within(wordCount(it.text), band);

  const picked = withinOrFallback(items, inRange, want, {
    exclude: options?.exclude,
    getId: (it) => it.itemId,
  });
  return markFallback(shuffle(picked.items).slice(0, want), picked.fellBack);
}

/**
 * 자극의 밴드 — 음절 수가 곧 조음 위치 전환 수 + 1이다.
 *
 * 음절은 **라벨의 하이픈 마디**로 센다('퍼-터-커', 'puh-tuh-kuh'). 글자 수로 세면
 * 한국어는 맞지만 영어는 'puh' 한 음절이 세 글자다. 한국어 라벨은 원래 음절마다
 * 하이픈이 있어 두 방식이 같은 값을 낸다(테스트가 고정).
 */
function ddkKindOf(label: string): DdkKind {
  const n = label.split('-').length;
  if (n === 1) return 'amr';
  return n === 2 ? 'smr2' : 'smr3';
}

/** 말운동(DDK) 문항 추출. 레벨이 밴드와 반복 요구량을 함께 정한다. */
export function pickDdkItems(
  count: number,
  level?: number,
  options?: PickSpeechOptions,
): QabDdkItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  const bank = bankFor(options?.locale);
  const spec = ddkSpecForLevel(level);

  // 목표 횟수는 자극 데이터가 아니라 레벨이 정한다 — 같은 '퍼'라도 레벨마다
  // 요구가 달라야 5단계가 5단계로 작동한다.
  const items: QabDdkItem[] = bank.ddk.map((d, i) => ({
    itemId: `${bank.idPrefix}ddk_${i}`,
    syllable: d.syllable,
    label: d.label,
    targetCount: spec.targetCount,
    instruction: bank.instructions.ddk,
    presentedLevel: level,
  }));
  const inRange = (it: QabDdkItem): boolean =>
    ddkKindOf(it.label) === spec.kind;

  const picked = withinOrFallback(items, inRange, want);
  return markFallback(shuffle(picked.items).slice(0, want), picked.fellBack);
}

// 난이도 규칙의 집은 domain/difficultyRules.ts다(D2).
export {
  ddkSpecForLevel,
  readingBandForLevel,
  readingRangeForLevel,
  repeatBandsForLevel,
  repeatSpecForLevel,
} from '../domain/difficultyRules.js';
export type { DdkKind, DdkSpec } from '../domain/difficultyRules.js';
