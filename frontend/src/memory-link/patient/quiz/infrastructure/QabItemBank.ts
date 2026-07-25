// QAB 질문형 문항 뱅크 (프론트 정적 데이터)
//
// 데일리 퀴즈와 섞을 "질문형" 문항을 기존 QAB 검사 데이터에서 가져온다.
//  - wordComp: 단어 듣고 그림 4지선다
//  - sentComp: 문장 듣고 그림 2지선다
// 음성은 mp3 대신 TTS로 발음하므로 audioUrl은 쓰지 않는다.
// 정답(isCorrect)은 프론트 로컬 채점을 위해 그대로 보존한다(데일리와 달리 정답이 클라에 있음).

// 단어이해 풀: 기존 wordComp 이미지(74종)로 자동 생성한 확장 뱅크.
// (표준 wordComp 검사 JSON은 그대로 두고, 혼합 퀴즈용 풀만 별도로 확장한다.)
import wordPoolData from '../../../../assets/data/qabWordPool.json';
import namingPhotos from '../../../../assets/data/namingPhotos.json';
import sentCompData from '../../../../assets/data/sentCompItems.json';
// 거울 문항(정답/오답 반전)으로 문장이해 풀을 새 이미지 없이 2배로 확장한다.
import sentMirrorData from '../../../../assets/data/qabSentMirror.json';
// AI 이미지 생성 스크립트(scripts/generate_sentcomp_images.py)가 만든 신규 장면 문항.
// 이미지가 생성된 항목만 포함되며, 스크립트 실행 전에는 비어 있다.
import sentGeneratedData from '../../../../assets/data/qabSentGenerated.json';
import type { QabImageItem, QabNamingItem } from '../domain/MixedQuiz.js';

interface RawWordChoice {
  choiceId: string;
  label: string;
  imageUrl: string;
  isCorrect: boolean;
}
interface RawWordItem {
  itemId: string;
  targetWord: string;
  choices: RawWordChoice[];
}
interface RawSentChoice {
  imageUrl: string;
  altText: string;
  isCorrect: boolean;
}
interface RawSentItem {
  itemId: string;
  sentence: string;
  sentenceAudioUrl: string;
  sentenceType: string;
  choices: RawSentChoice[];
}

const WORD_ITEMS: RawWordItem[] = (wordPoolData as { items: RawWordItem[] }).items;
const SENT_ITEMS: RawSentItem[] = [
  ...(sentCompData as unknown as RawSentItem[]),
  ...((sentMirrorData as { items: RawSentItem[] }).items),
  ...((sentGeneratedData as { items: RawSentItem[] }).items),
];

const WORD_INSTRUCTION = '들려주는 단어의 그림을 골라주세요';
const SENT_INSTRUCTION = '들려주는 문장에 맞는 그림을 골라주세요';
const NAMING_INSTRUCTION = '그림을 보고 이름을 말해주세요';

/** Fisher-Yates 셔플 (원본 불변, 새 배열 반환). */
function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function toWordItem(it: RawWordItem): QabImageItem {
  return {
    itemId: it.itemId,
    category: 'word',
    promptText: it.targetWord,
    instruction: WORD_INSTRUCTION,
    choices: shuffle(it.choices).map((c) => ({
      choiceId: c.choiceId,
      label: c.label,
      imageUrl: c.imageUrl,
      isCorrect: c.isCorrect,
    })),
  };
}

function toSentItem(it: RawSentItem): QabImageItem {
  return {
    itemId: it.itemId,
    category: 'sentence',
    promptText: it.sentence,
    instruction: SENT_INSTRUCTION,
    // 선택지 id가 원본에 없으므로 itemId+index로 합성한다.
    choices: shuffle(
      it.choices.map((c, idx) => ({
        choiceId: `${it.itemId}_c${idx}`,
        label: c.altText,
        imageUrl: c.imageUrl,
        isCorrect: c.isCorrect,
      })),
    ),
  };
}

/** 실물 사진이 준비된 단어 slug 집합. */
const NAMING_PHOTO_SLUGS = new Set<string>(namingPhotos.slugs);

/** 이미지 URL에서 파일명 slug를 뽑는다. "/a/b/apple.svg" → "apple". */
function slugFromUrl(url: string): string {
  return url.split('/').pop()!.replace(/\.[^.]+$/, '');
}

/**
 * 그림 이름대기(검사5) 문항으로 변환.
 *
 * 왜 이름대기만 사진이고 단어이해는 선화인가:
 *   표준 실어증 검사(K-WAB, BNT)가 선화를 쓰는 건 '진단 도구로서의 통제'
 *   때문이다 — 사진은 색·품종·조명·각도가 섞여, 틀렸을 때 단어를 몰라서인지
 *   그 사진 속 개체를 못 알아봐서인지 구분이 안 된다. 표준화·재현성에는
 *   선화가 맞다.
 *   그러나 이 앱은 진단이 아니라 가정 자가 훈련이다. 여기서는 엄밀성보다
 *   환자의 참여·반응이 중요하고, 고령·치매 환자는 산출 과제에서 추상적
 *   선화보다 실물 사진에 더 잘 반응한다. 그래서 이름대기는 사진으로 간다.
 *   단어이해(4지선다)는 변별이 핵심이라 통제를 유지(선화)한다 — 정답만
 *   사진이면 단어를 몰라도 사진만 골라 다 맞아 검사가 무효가 된다.
 *
 * 구현: 사진이 준비된 단어는 /assets/images/naming/<slug>.png를, 아직 없는
 * 단어는 단어이해 SVG를 그대로 쓴다(폴백). 정답 선택지가 없으면 null.
 */
function toNamingItem(it: RawWordItem): QabNamingItem | null {
  const correct = it.choices.find((c) => c.isCorrect);
  if (!correct) return null;
  const slug = slugFromUrl(correct.imageUrl);
  const imageUrl = NAMING_PHOTO_SLUGS.has(slug)
    ? `/assets/images/naming/${slug}.png`
    : correct.imageUrl;
  return {
    itemId: `naming_${it.itemId}`,
    imageUrl,
    targetWord: it.targetWord,
    instruction: NAMING_INSTRUCTION,
  };
}

/** 그림 이름대기 문항을 무작위 count개 추출. */
export function pickNamingItems(count: number): QabNamingItem[] {
  return shuffle(WORD_ITEMS)
    .map(toNamingItem)
    .filter((x): x is QabNamingItem => x !== null)
    .slice(0, Math.max(0, count));
}

/** 단어이해 문항을 무작위 count개 추출. */
export function pickWordItems(count: number): QabImageItem[] {
  return shuffle(WORD_ITEMS).slice(0, Math.max(0, count)).map(toWordItem);
}

/** 문장이해 문항을 무작위 count개 추출. */
export function pickSentItems(count: number): QabImageItem[] {
  return shuffle(SENT_ITEMS).slice(0, Math.max(0, count)).map(toSentItem);
}

/**
 * 단어/문장 이해를 섞어 count개를 추출한다(질문형 슬롯 채우기).
 * 두 뱅크를 합쳐 셔플 → count개. 한쪽이 부족하면 다른 쪽에서 더 채워진다.
 */
export function pickQabItems(count: number): QabImageItem[] {
  const pool: QabImageItem[] = [
    ...WORD_ITEMS.map(toWordItem),
    ...SENT_ITEMS.map(toSentItem),
  ];
  return shuffle(pool).slice(0, Math.max(0, count));
}

/** 뱅크 문항 수 (단어/문장 합계) */
export function qabItemCount(): number {
  return WORD_ITEMS.length + SENT_ITEMS.length;
}
