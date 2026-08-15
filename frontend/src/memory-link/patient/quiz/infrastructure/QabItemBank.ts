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

// ── 통제된 유인지(distractor) 생성 ─────────────────────────────
//
// 기존에는 오답지가 문항 JSON에 무작위 무관 단어로 박혀 있어, 같은 범주 유인지가
// 없으면 소거법으로 다 맞아 변별력이 없었다(예: 비행기 ↔ 바나나·우체통).
// 표준 실어증 검사(K-WAB, BNT)처럼 "같은 의미 범주 2 + 무관 1"로 유인지를
// 구성해, 범주만 알면 못 맞추고 '정확히 그 단어'를 이해해야 맞도록 만든다.

/** slug → 의미 범주. 미등록 slug는 'object'로 폴백(크래시 방지). (테스트 노출) */
export const WORD_CATEGORY: Record<string, string> = {
  // 동물
  butterfly: 'animal', cat: 'animal', chick: 'animal', dog: 'animal',
  elephant: 'animal', lion: 'animal', tiger: 'animal', turtle: 'animal',
  whale: 'animal',
  // 음식
  apple: 'food', banana: 'food', bread: 'food', candy: 'food', grape: 'food',
  juice: 'food', melon: 'food', milk: 'food', orange: 'food', pear: 'food',
  strawberry: 'food', sweet_potato: 'food', tomato: 'food', watermelon: 'food',
  // 탈것
  airplane: 'vehicle', bicycle: 'vehicle', bus: 'vehicle', car: 'vehicle',
  ship: 'vehicle', train: 'vehicle',
  // 식물
  flower: 'plant', tree: 'plant',
  // 장소
  hospital: 'place', library: 'place', pharmacy: 'place', pool: 'place',
  school: 'place',
  // 사물(가장 큰 범주 — 생활용품·도구·의류 등)
  bag: 'object', balloon: 'object', basket: 'object', bed: 'object',
  blanket: 'object', book: 'object', chair: 'object', clock: 'object',
  comb: 'object', computer: 'object', desk: 'object', glasses: 'object',
  gloves: 'object', guitar: 'object', hammer: 'object', hat: 'object',
  kettle: 'object', key: 'object', knife: 'object', ladder: 'object',
  ladle: 'object', mailbox: 'object', mirror: 'object', notebook: 'object',
  pencil: 'object', phone: 'object', piano: 'object', pot: 'object',
  refrigerator: 'object', rice_cooker: 'object', sand: 'object',
  scissors: 'object', shoes: 'object', soap: 'object', socks: 'object',
  toothbrush: 'object', toothpaste: 'object', towel: 'object',
  trumpet: 'object', umbrella: 'object', washing_machine: 'object',
  spine: 'body', student: 'person',
  // Fluent 전면 교체 시 추가/교체된 단어(상업 라이선스). mirror는 위에 이미 있음.
  candle: 'object', couch: 'object', spoon: 'object', rock: 'object',
  television: 'object',
  bear: 'animal', rabbit: 'animal', pig: 'animal',
  corn: 'food', carrot: 'food', cake: 'food',
  cactus: 'plant', mushroom: 'plant',
  house: 'place', truck: 'vehicle',
};

interface MasterWord {
  slug: string;
  label: string;
  imageUrl: string;
  category: string;
}

/** 정답 선택지 기준 마스터 단어 풀(유인지 후보). slug 기준 중복 제거. */
const MASTER_WORDS: MasterWord[] = (() => {
  const bySlug = new Map<string, MasterWord>();
  for (const it of WORD_ITEMS) {
    const correct = it.choices.find((c) => c.isCorrect);
    if (!correct) continue;
    const slug = slugFromUrl(correct.imageUrl);
    if (bySlug.has(slug)) continue;
    bySlug.set(slug, {
      slug,
      label: correct.label,
      imageUrl: correct.imageUrl,
      category: WORD_CATEGORY[slug] ?? 'object',
    });
  }
  return [...bySlug.values()];
})();

// ── 레벨별 렌더 난이도 스펙 ─────────────────────────────────────
//
// 그림선택 난이도는 항목 자체가 아니라 "렌더 시점의 오답 구성"으로 정한다.
// 같은 항목도 환자의 현재 레벨에 따라 다르게 제시한다. 두 축으로 단조 증가:
//   - total  : 선택지 총 개수(많을수록 부담↑, 소거 어려움↑)
//   - sameCat: 같은 의미 범주 오답 수(많을수록 범주만으론 못 맞춤 → 변별↑)
// 낮은 레벨은 선택지 적고 오답이 무관(먼) 단어라 쉽고, 높은 레벨은 선택지 많고
// 오답이 전부 같은 범주(근접)라 어렵다.
export interface ChoiceSpec {
  total: number;
  sameCat: number;
}
export const LEVEL_CHOICE_SPEC: Record<number, ChoiceSpec> = {
  1: { total: 2, sameCat: 0 }, // 정답 + 무관 1
  2: { total: 3, sameCat: 1 }, // 정답 + 같은범주1 + 무관1
  3: { total: 4, sameCat: 2 }, // 정답 + 같은범주2 + 무관1 (기존 기본)
  4: { total: 4, sameCat: 3 }, // 정답 + 같은범주3 (전부 근접)
  5: { total: 5, sameCat: 4 }, // 선택지 늘고 전부 근접
};

/** 레벨을 [1..5]로 클램프하고 해당 스펙을 돌려준다(미지정/범위밖은 3=기본). */
function choiceSpecForLevel(level?: number): ChoiceSpec {
  const lv = level == null ? 3 : Math.max(1, Math.min(5, Math.round(level)));
  return LEVEL_CHOICE_SPEC[lv];
}

/**
 * 통제된 유인지를 골라 정답과 함께 레벨별 보기를 만든다.
 * spec.total개(정답 1 + 오답 total-1)를 만들되, 오답 중 spec.sameCat개는 같은
 * 의미 범주, 나머지는 무관 범주에서 뽑는다. 풀이 모자라면 가능한 만큼만 채운다.
 * level 미지정 시 레벨 3(같은범주2+무관1) — 기존 동작 보존. (테스트 노출)
 */
export function buildControlledChoices(target: MasterWord, level?: number) {
  const spec = choiceSpecForLevel(level);
  const foilTotal = Math.max(0, spec.total - 1);
  const sameCatWanted = Math.min(spec.sameCat, foilTotal);

  const sameCat = shuffle(
    MASTER_WORDS.filter(
      (w) => w.slug !== target.slug && w.category === target.category,
    ),
  );
  const otherCat = shuffle(
    MASTER_WORDS.filter((w) => w.category !== target.category),
  );

  const foils: MasterWord[] = [];
  foils.push(...sameCat.slice(0, sameCatWanted)); // 같은 범주(부족하면 그만큼만)
  for (const w of otherCat) {
    // 무관 오답으로 나머지를 채운다(같은 범주가 모자랄 때도 여기서 보충).
    if (foils.length >= foilTotal) break;
    if (!foils.some((f) => f.slug === w.slug)) foils.push(w);
  }
  // 그래도 부족하면(풀이 아주 작을 때) 아무거나 채운다.
  if (foils.length < foilTotal) {
    for (const w of shuffle(MASTER_WORDS)) {
      if (foils.length >= foilTotal) break;
      if (w.slug !== target.slug && !foils.some((f) => f.slug === w.slug)) {
        foils.push(w);
      }
    }
  }

  const raw = [
    { slug: target.slug, label: target.label, imageUrl: target.imageUrl, isCorrect: true },
    ...foils.slice(0, foilTotal).map((f) => ({
      slug: f.slug, label: f.label, imageUrl: f.imageUrl, isCorrect: false,
    })),
  ];
  return shuffle(raw).map((c, idx) => ({
    choiceId: `${target.slug}_c${idx}`,
    label: c.label,
    imageUrl: c.imageUrl,
    isCorrect: c.isCorrect,
  }));
}

function toWordItem(it: RawWordItem, level?: number): QabImageItem {
  const correct = it.choices.find((c) => c.isCorrect);
  const slug = correct ? slugFromUrl(correct.imageUrl) : '';
  const target = MASTER_WORDS.find((w) => w.slug === slug);
  // 마스터 풀에 없으면(예외) 기존 JSON 보기로 폴백해 안전하게 렌더.
  const choices = target
    ? buildControlledChoices(target, level)
    : shuffle(it.choices).map((c) => ({
        choiceId: c.choiceId,
        label: c.label,
        imageUrl: c.imageUrl,
        isCorrect: c.isCorrect,
      }));
  return {
    itemId: it.itemId,
    category: 'word',
    promptText: it.targetWord,
    instruction: WORD_INSTRUCTION,
    choices,
    presentedLevel: level,
  };
}

function toSentItem(it: RawSentItem, level?: number): QabImageItem {
  // 문장이해 선택지는 원본 JSON의 고정 쌍이라 레벨로 오답거리를 바꾸지 않는다.
  // presentedLevel은 스탬핑해 정오답 기반 레벨링은 동작하게 한다(변별 난이도는 추후).
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
    presentedLevel: level,
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
function toNamingItem(it: RawWordItem, level?: number): QabNamingItem | null {
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
    presentedLevel: level,
  };
}

/** 그림 이름대기 문항을 무작위 count개 추출. level은 제시 레벨로 스탬핑된다. */
export function pickNamingItems(count: number, level?: number): QabNamingItem[] {
  return shuffle(WORD_ITEMS)
    .map((it) => toNamingItem(it, level))
    .filter((x): x is QabNamingItem => x !== null)
    .slice(0, Math.max(0, count));
}

/** 단어이해 문항을 무작위 count개 추출. level로 선택지 난이도를 정한다. */
export function pickWordItems(count: number, level?: number): QabImageItem[] {
  return shuffle(WORD_ITEMS)
    .slice(0, Math.max(0, count))
    .map((it) => toWordItem(it, level));
}

/** 문장이해 문항을 무작위 count개 추출. */
export function pickSentItems(count: number, level?: number): QabImageItem[] {
  return shuffle(SENT_ITEMS)
    .slice(0, Math.max(0, count))
    .map((it) => toSentItem(it, level));
}

/**
 * 단어/문장 이해를 섞어 count개를 추출한다(질문형 슬롯 채우기).
 * 두 뱅크를 합쳐 셔플 → count개. 한쪽이 부족하면 다른 쪽에서 더 채워진다.
 * levels로 단어/문장 각각의 제시 레벨을 지정한다(미지정 시 기존 동작=레벨 3).
 */
export function pickQabItems(
  count: number,
  levels?: { word?: number; sentence?: number },
): QabImageItem[] {
  const pool: QabImageItem[] = [
    ...WORD_ITEMS.map((it) => toWordItem(it, levels?.word)),
    ...SENT_ITEMS.map((it) => toSentItem(it, levels?.sentence)),
  ];
  return shuffle(pool).slice(0, Math.max(0, count));
}

/** 뱅크 문항 수 (단어/문장 합계) */
export function qabItemCount(): number {
  return WORD_ITEMS.length + SENT_ITEMS.length;
}
