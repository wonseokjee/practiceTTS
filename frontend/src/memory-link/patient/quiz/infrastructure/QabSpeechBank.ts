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
 * 따라말하기 문항 추출. 단어/문장 풀을 합쳐 무작위로 count개.
 * (단어·문장이 섞여 나오며, 비율을 보장하지는 않는다.)
 */
export function pickRepeatItems(count: number): QabRepeatItem[] {
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
  return shuffle([...words, ...sentences]).slice(0, Math.max(0, count));
}

/** 소리 내어 읽기 문항 추출. */
export function pickReadingItems(count: number): QabReadingItem[] {
  const items: QabReadingItem[] = STIMULI.readingSentences.map((text, i) => ({
    itemId: `reading_${i}`,
    text,
    instruction: READING_INSTRUCTION,
  }));
  return shuffle(items).slice(0, Math.max(0, count));
}

/** 말운동(DDK) 문항 추출. */
export function pickDdkItems(count: number): QabDdkItem[] {
  const items: QabDdkItem[] = STIMULI.ddk.map((d, i) => ({
    itemId: `ddk_${i}`,
    syllable: d.syllable,
    label: d.label,
    targetCount: d.targetCount,
    instruction: DDK_INSTRUCTION,
  }));
  return shuffle(items).slice(0, Math.max(0, count));
}
