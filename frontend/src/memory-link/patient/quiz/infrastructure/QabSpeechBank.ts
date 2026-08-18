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
  targetCount: number;
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
  }));
  const sentences: QabRepeatItem[] = STIMULI.repeatSentences.map((text, i) => ({
    itemId: `repeat_s${i}`,
    category: 'sentence',
    text,
    instruction: REPEAT_INSTRUCTION,
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
  }));
  const inRange = (it: QabReadingItem): boolean => {
    const n = wordCount(it.text);
    return n >= min && n <= max;
  };

  return shuffle(withinOrFallback(items, inRange, want)).slice(0, want);
}

/**
 * 말운동 난이도 축 — **AMR과 SMR**. 이건 임상에서 실재하는 구분이다.
 *
 *  - AMR(교대운동속도): 단음절 반복 '퍼', '터', '커' — 한 조음 위치의 속도
 *  - SMR(연속운동속도): 다음절 연쇄 '퍼터커' — 조음 위치를 **바꿔가며** 내야 하고,
 *    구음장애에서 AMR보다 먼저·크게 무너진다
 *
 * 그래서 낮은 레벨은 AMR만, 높은 레벨에서 SMR을 낸다. 길이(음절 수)로 판정하므로
 * 자극이 늘어도 규칙이 그대로 성립한다.
 */
export function ddkAllowsSmrForLevel(level?: number): boolean {
  return normalizeLevel(level, COLD_START_LEVEL) >= 4;
}

/** 말운동(DDK) 문항 추출. 레벨이 AMR만 낼지 SMR까지 낼지를 정한다. */
export function pickDdkItems(count: number, level?: number): QabDdkItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  const allowSmr = ddkAllowsSmrForLevel(level);

  const items: QabDdkItem[] = STIMULI.ddk.map((d, i) => ({
    itemId: `ddk_${i}`,
    syllable: d.syllable,
    label: d.label,
    targetCount: d.targetCount,
    instruction: DDK_INSTRUCTION,
  }));
  // SMR = 음절 2개 이상('퍼터커'). 낮은 레벨에선 제외한다.
  const inRange = (it: QabDdkItem): boolean =>
    allowSmr || syllableCount(it.syllable) === 1;

  return shuffle(withinOrFallback(items, inRange, want)).slice(0, want);
}
