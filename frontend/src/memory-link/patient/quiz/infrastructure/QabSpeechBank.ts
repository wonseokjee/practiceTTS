// QAB 발화 검사 문항 뱅크 (프론트 정적 데이터)
//
// 검사6 따라말하기 / 검사7 소리 내어 읽기 / 검사8 말운동(DDK) 문항을
// qabSpeechStimuli.json에서 무작위 추출한다. 채점은 모두 프론트 로컬.

import stimuliData from '../../../../assets/data/qabSpeechStimuli.json';
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
 * 레벨을 모를 때 쓰는 기본값. 백엔드 `COLD_START_LEVEL`과 **같아야 한다**.
 * QabItemBank와 같은 값을 쓴다 — 한 세션 안에서 검사마다 다른 눈높이를 잡으면
 * 레벨별 정답률이 서로 비교 불가능해진다.
 */
const COLD_START_LEVEL = 2;

/** 적응 레벨을 [1..5] 정수로 정규화한다(QabItemBank.normalizeLevel과 같은 규칙). */
function normalizeLevel(level: number | undefined, fallback: number): number {
  if (level == null) return fallback;
  return Math.max(1, Math.min(5, Math.round(level)));
}

/** 어절 수 — 공백 기준. 한국어 문장 난이도의 1차 축이다. */
function wordCount(sentence: string): number {
  return sentence.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/** 음절 수 — 한글 한 글자 = 한 음절. */
function syllableCount(word: string): number {
  return Array.from(word.replace(/\s+/g, '')).length;
}

/**
 * 요청한 범위로 거르되, 모자라면 범위를 풀어 문항이 조용히 사라지지 않게 한다.
 * (난이도가 조금 어긋나는 편이 세션이 비는 것보다 낫다 — QabItemBank와 같은 원칙.)
 */
function withinOrFallback<T>(
  pool: readonly T[],
  inRange: (item: T) => boolean,
  want: number,
): T[] {
  const eligible = pool.filter(inRange);
  return eligible.length >= want ? [...eligible] : [...pool];
}

const REPEAT_INSTRUCTION = '들려주는 말을 잘 듣고 따라 말해주세요';
const READING_INSTRUCTION = '아래 문장을 소리 내어 읽어주세요';
const DDK_INSTRUCTION = '아래 소리를 최대한 빠르고 또렷하게 반복해서 말해주세요';

/** Fisher-Yates 셔플 (원본 불변). */
function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 따라말하기 난이도 축 — **자극의 종류와 길이**.
 *
 * 따라말하기는 청각 작업기억 + 조음 두 부담이 겹친다. 단어는 조음만, 문장은
 * 둘 다 요구하므로 단어 → 문장이 자연스러운 난이도 순서다. 그 안에서 음절/어절
 * 수가 2차 축이 된다.
 *
 *   lv1  1~2음절 단어              (조음 부담 최소)
 *   lv2  2~3음절 단어
 *   lv3  3~4음절 단어 + 2~3어절 문장 (문장 진입)
 *   lv4  3~5어절 문장
 *   lv5  5~7어절 문장              (작업기억 한계 근처)
 */
export function repeatSpecForLevel(level?: number): {
  kind: 'word' | 'sentence' | 'mixed';
  min: number;
  max: number;
} {
  const lv = normalizeLevel(level, COLD_START_LEVEL);
  if (lv <= 1) return { kind: 'word', min: 1, max: 2 };
  if (lv <= 2) return { kind: 'word', min: 2, max: 3 };
  if (lv <= 3) return { kind: 'mixed', min: 3, max: 4 };
  if (lv <= 4) return { kind: 'sentence', min: 3, max: 5 };
  return { kind: 'sentence', min: 5, max: 7 };
}

/**
 * 따라말하기 문항 추출. 레벨이 종류(단어/문장)와 길이를 함께 정한다.
 * level 미지정 시 콜드스타트(2) — 2~3음절 단어.
 */
export function pickRepeatItems(
  count: number,
  level?: number,
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

  return shuffle(withinOrFallback(pool, inRange, want)).slice(0, want);
}

/**
 * 읽기 난이도 축 — **문장 길이(어절 수)**.
 *
 * 소리 내어 읽기는 시각 처리 + 조음 지속 + 호흡 조절이 함께 요구된다. 길이가
 * 늘수록 세 부담이 모두 커지므로 어절 수가 1차 축이다.
 *
 * 상한을 7어절로 둔 건 임의가 아니다. 실어증 읽기 자극은 짧은 문장이 표준이고,
 * 그보다 길면 검사가 아니라 좌절 경험이 된다.
 */
export function readingRangeForLevel(level?: number): {
  min: number;
  max: number;
} {
  const lv = normalizeLevel(level, COLD_START_LEVEL);
  if (lv <= 1) return { min: 2, max: 2 };
  if (lv <= 2) return { min: 2, max: 3 };
  if (lv <= 3) return { min: 3, max: 4 };
  if (lv <= 4) return { min: 4, max: 5 };
  return { min: 5, max: 7 };
}

/** 소리 내어 읽기 문항 추출. 레벨이 문장 길이를 정한다. */
export function pickReadingItems(
  count: number,
  level?: number,
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

  return shuffle(withinOrFallback(items, inRange, want)).slice(0, want);
}

/**
 * 말운동 난이도 축 — **조음 위치 전환 수** × **반복 요구량**.
 *
 *  - AMR(교대운동속도): 단음절 반복 '퍼', '터', '커' — 한 조음 위치의 속도
 *  - SMR(연속운동속도): 조음 위치를 **바꿔가며** 내야 하고, 구음장애에서 AMR보다
 *    먼저·크게 무너진다
 *
 * **밴드는 누적되지 않는다.** 예전에는 `allowSmr || 단음절`이라 레벨 4·5가 AMR을
 * 그대로 낼 수 있었고, 그러면 레벨 5로 기록된 문항이 실제로는 레벨 1 문항이었다.
 * 문장(#60)·낱말(#59)에서 이미 두 번 나온 같은 버그다.
 *
 * ── SMR을 두 밴드로 나눈 이유 ────────────────────────────────────
 *
 * 표준 세트는 AMR 3개 + SMR 1개('퍼터커')뿐이라 SMR 밴드에 자극이 하나였다.
 * 로테이션(하루 한 검사 3문항)에서는 그 하나를 세 번 내거나 폴백이 AMR을 끌어와
 * 위의 누적 버그가 되살아난다.
 *
 * 그래서 **전환 수**로 SMR을 갈랐다. '퍼터'는 전환 1회, '퍼터커'는 2회다. 전환이
 * 늘수록 조음기관의 재배치 요구가 커지므로 이건 지어낸 축이 아니라 SMR을 SMR답게
 * 만드는 바로 그 변수다. 3음절 역순('커터퍼'·'터커퍼')은 표준 순서가 아니지만
 * 전환 수가 같고 순서 계획 부담만 더해져 같은 밴드에 둘 수 있다.
 *
 * 밴드마다 자극이 정확히 3개라 로테이션의 3문항을 폴백 없이 채운다.
 *
 *   lv1  AMR   6회   한 조음 위치, 짧게      퍼 / 터 / 커
 *   lv2  AMR  10회   표준 AMR
 *   lv3  AMR  14회   조음 유지·호흡 부담
 *   lv4  SMR2  5회   전환 1회               퍼터 / 터커 / 퍼커
 *   lv5  SMR3  8회   전환 2회 + 지속        퍼터커 / 커터퍼 / 터커퍼
 */
export type DdkKind = 'amr' | 'smr2' | 'smr3';

export interface DdkSpec {
  kind: DdkKind;
  targetCount: number;
}

const LEVEL_DDK_SPEC: Record<number, DdkSpec> = {
  1: { kind: 'amr', targetCount: 6 },
  2: { kind: 'amr', targetCount: 10 },
  3: { kind: 'amr', targetCount: 14 },
  4: { kind: 'smr2', targetCount: 5 },
  5: { kind: 'smr3', targetCount: 8 },
};

export function ddkSpecForLevel(level?: number): DdkSpec {
  return LEVEL_DDK_SPEC[normalizeLevel(level, COLD_START_LEVEL)];
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

  return shuffle(withinOrFallback(items, inRange, want)).slice(0, want);
}
