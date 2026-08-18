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
import type {
  QabImageItem,
  QabNamingItem,
  QabSpellItem,
} from '../domain/MixedQuiz.js';

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
function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
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
/**
 * 레벨을 모를 때 쓰는 기본값. 백엔드 `COLD_START_LEVEL`과 **같아야 한다** —
 * 다르면 환자가 본 난이도와 서버가 기록한 레벨이 어긋난다.
 */
const COLD_START_LEVEL = 2;

/**
 * 적응 레벨을 [1..5] 정수로 정규화한다. **난이도 축이 여럿이라 반드시 공유해야 한다.**
 *
 * 예전에는 이 식(`level == null ? 기본 : clamp(round(level))`)이 세 함수에 복사돼
 * 있었고, 이미 갈라져 있었다 — 두 곳은 `COLD_START_LEVEL`(=2), 한 곳은 `3`.
 * 축마다 다른 레벨을 보면 "레벨 5인데 방해 타일은 레벨 2 수준" 같은 조합이 나오고,
 * 각 함수를 따로 검증하는 테스트로는 그 어긋남을 잡을 수 없다.
 *
 * `fallback`을 **인자로 강제**하는 건 의도적이다. 그림선택은 기존 동작 보존을 위해
 * 3을 쓰고 글자 조합은 콜드스타트 2를 쓴다 — 서로 다른 게 맞는 값이라, 기본값을
 * 숨기면 호출자가 어느 쪽을 받는지 모르게 된다.
 */
function normalizeLevel(level: number | undefined, fallback: number): number {
  if (level == null) return fallback;
  return Math.max(1, Math.min(5, Math.round(level)));
}

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
  const lv = normalizeLevel(level, 3);
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
  // 선택지는 원본 JSON의 고정 쌍이라 **여기서** 오답거리를 바꾸지는 않는다.
  // 문장이해의 난이도는 선택지가 아니라 **자극의 통사 복잡도**로 준다 —
  // 어느 문항을 낼지는 sentPoolForLevel이 레벨로 정한다.
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

// ─── 글자 조합(spell) ─────────────────────────────────────────────

/**
 * 방해 타일 후보 — 받침 유무가 섞인 흔한 한글 음절.
 * 레벨 4~5에서 음운 유사 방해자로 좁히는 것은 후속 과제다(지금은 무작위).
 */
const SPELL_DISTRACTOR_POOL: readonly string[] = [
  '가', '나', '다', '라', '마', '바', '사', '아', '자', '하',
  '고', '노', '도', '로', '모', '보', '소', '오', '조', '호',
  '구', '누', '두', '루', '무', '부', '수', '우', '주', '후',
  '강', '산', '물', '불', '집', '길', '밤', '낮', '봄', '꽃',
];

/** 타일 총 개수 상한 (한 줄에 담기는 가독성). */
const SPELL_MAX_TILES = 8;

/**
 * 레벨 → 방해 타일 수.
 *
 * 상용 실어증 치료 도구가 이 과제를 단어 길이 × 방해 글자 **0 / 2 / 4개**로
 * 등급화하는 것을 그대로 따른다. 레벨 1~2에 **방해 0개**(정답 음절 재배열만)를
 * 두는 게 핵심이다 — 예전 구현은 늘 3개라 가장 쉬운 진입 단계가 없었다.
 */
export function distractorCountForLevel(level?: number): number {
  // 레벨을 모를 때(스킬 레벨 조회 실패)는 **백엔드 콜드스타트와 같은 값**을 쓴다.
  // 임의의 중간값(3)을 쓰면 환자는 방해 2개짜리를 푸는데 서버는 레벨 2(방해 0개)로
  // 도장을 찍어, 본 난이도와 기록이 어긋난다. 적응 레벨링의 전제가
  // "presented_level로 능력과 제시난이도 교란을 제거한다"이므로 그 전제가 깨진다.
  // 서버가 클라이언트 값을 믿지 않는 건 의도된 설계(eb09bd8)라, 맞춰야 하는 쪽은
  // 프론트의 기본값이다.
  const lv = normalizeLevel(level, COLD_START_LEVEL);
  if (lv <= 2) return 0;
  if (lv <= 4) return 2;
  return 4;
}

/**
 * 목표 단어를 음절로 쪼개고 방해 음절을 섞어 셔플한 타일을 만든다.
 * 정답 음절의 중복은 보존한다(예: '바나나' → 바·나·나).
 */
export function buildSpellTiles(
  targetWord: string,
  level?: number,
  rng: () => number = Math.random,
): string[] {
  const answer = Array.from(targetWord.replace(/\s+/g, ''));
  if (answer.length === 0) return [];
  const answerSet = new Set(answer);
  const room = Math.max(0, SPELL_MAX_TILES - answer.length);
  const wanted = Math.min(distractorCountForLevel(level), room);
  const distractors = shuffle(
    SPELL_DISTRACTOR_POOL.filter((s) => !answerSet.has(s)),
    rng,
  ).slice(0, wanted);
  return shuffle([...answer, ...distractors], rng);
}

/**
 * 레벨 → 목표 단어 음절 수 범위.
 *
 * 방해 타일 수만으로는 난이도가 통제되지 않는다. 4음절 단어에 방해 0개는 2음절
 * 단어에 방해 0개와 전혀 다른 과제인데, 예전에는 2~4음절이 섞여 나와 레벨별
 * 정답률이 어휘·순서 부하와 교란됐다("이 환자는 방해 2개에서 잘한다"가 아니라
 * "짧은 단어가 운 좋게 많이 나왔다"를 학습한다).
 *
 * 길이와 방해 수를 함께 올려 두 축이 같은 방향을 보게 한다.
 */
function syllableRangeForLevel(level?: number): { min: number; max: number } {
  const lv = normalizeLevel(level, COLD_START_LEVEL);
  if (lv <= 2) return { min: 2, max: 2 };
  if (lv <= 4) return { min: 2, max: 3 };
  return { min: 3, max: 4 };
}

/** 공백 제외 음절 수. */
function syllableCount(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length;
}

/**
 * 화면에 보이는 한글 낱말 그 자체 (예: `'사과'`).
 *
 * `SpellItemRef`와 **절대 섞이면 안 된다.** 둘 다 실체는 string이라, 브랜드를
 * 안 붙이면 서로 바꿔 넣어도 컴파일이 통과하고 런타임에도 예외가 없다 —
 * 그냥 조용히 아무 효과가 없어지고 결과가 무작위처럼 보인다. 실제로 한 번 그랬다.
 */
export type SpellWordLabel = string & { readonly __brand: 'SpellWordLabel' };

/** 제출 이력에서 쓰는 문항 식별자 (예: `'spell_qw_002'`). {@link SpellWordLabel} 참고. */
export type SpellItemRef = string & { readonly __brand: 'SpellItemRef' };

/** 한글 낱말을 {@link SpellWordLabel}로 표시한다(값은 그대로). */
export const asWordLabel = (s: string): SpellWordLabel => s as SpellWordLabel;

/** 제출 이력의 itemRef를 {@link SpellItemRef}로 표시한다(값은 그대로). */
export const asItemRef = (s: string): SpellItemRef => s as SpellItemRef;

export interface PickSpellOptions {
  /**
   * 제외할 **낱말**(`'사과'`). 같은 세션의 단어이해 문항이 정답 낱말을 TTS로
   * 들려주므로(promptText), 겹치면 답을 알려준 셈이 된다.
   */
  exclude?: readonly SpellWordLabel[];
  /**
   * 우선 재출제할 **문항 식별자**(`'spell_qw_002'`) — 낱말이 아니다.
   *
   * 앞에 올수록 먼저 뽑힌다. 백엔드 `GET /quiz/recent-items`가 이미
   * (틀린 것 먼저, 그 안에서 마지막 출제가 오래된 것 먼저) 순으로 주므로,
   * 그 응답 순서를 그대로 넘기면 그것이 곧 간격 반복이 된다 — 틀린 건 바로
   * 다시, 맞힌 건 오래 안 나온 것부터.
   *
   * 실어증 치료 이득은 훈련한 그 항목을 크게 넘어가지 않으므로
   * (limited transfer), 같은 낱말이 여러 세션에 걸쳐 반복돼야 의미가 있다.
   * 비면 무작위로 떨어진다.
   */
  priority?: readonly SpellItemRef[];
}

/**
 * 글자 조합 문항을 count개 추출.
 *
 * 선택 순서: (1) 레벨에 맞는 음절 수 + 제외 목록으로 후보를 좁히고,
 * (2) `priority`에 있는 단어를 앞으로 당기고, (3) 나머지는 무작위.
 *
 * 후보를 먼저 좁힌 뒤에 타일을 만든다 — 예전에는 70개 전부에 타일을 만들고
 * 1개만 썼다. 이력 조회가 얹히는 지금은 그 낭비가 그대로 비용이 된다.
 */
export function pickSpellItems(
  count: number,
  level?: number,
  options?: PickSpellOptions,
): QabSpellItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];

  const { min, max } = syllableRangeForLevel(level);
  const excluded = new Set(options?.exclude ?? []);
  const priority = options?.priority ?? [];
  const priorityRank = new Map<string, number>(
    priority.map((ref, i) => [ref, i]),
  );

  // 두 키 공간을 각자의 브랜드로 만들어 낸다 — 타입이 뒤바뀜을 막아준다.
  const labelOf = (it: RawWordItem): SpellWordLabel =>
    asWordLabel(it.choices.find((c) => c.isCorrect)?.label ?? '');
  const refOf = (it: RawWordItem): SpellItemRef =>
    asItemRef(`spell_${it.itemId}`);

  const eligible = WORD_ITEMS.filter((it) => {
    const label = labelOf(it);
    if (label.length === 0 || excluded.has(label)) return false;
    const n = syllableCount(label);
    return n >= min && n <= max;
  });

  // 레벨 범위에 맞는 단어가 부족하면 범위를 풀어 세션이 비지 않게 한다
  // (문항이 조용히 사라지는 것보다 난이도가 조금 어긋나는 편이 낫다).
  const pool = eligible.length >= want
    ? eligible
    : WORD_ITEMS.filter((it) => {
        const label = labelOf(it);
        return label.length > 0 && !excluded.has(label) && syllableCount(label) >= 2;
      });

  const ordered = shuffle(pool).sort((a, b) => {
    const ra = priorityRank.get(refOf(a)) ?? Number.MAX_SAFE_INTEGER;
    const rb = priorityRank.get(refOf(b)) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });

  const picked: QabSpellItem[] = [];
  for (const it of ordered) {
    if (picked.length >= want) break;
    const item = toSpellItem(it, level);
    if (item !== null) picked.push(item);
  }
  return picked;
}

function toSpellItem(it: RawWordItem, level?: number): QabSpellItem | null {
  const correct = it.choices.find((c) => c.isCorrect);
  if (!correct) return null;
  const tiles = buildSpellTiles(correct.label, level);
  // 1음절 단어는 조합할 게 없어 과제가 성립하지 않는다.
  if (tiles.length === 0 || Array.from(correct.label.trim()).length < 2) {
    return null;
  }
  return {
    itemId: `spell_${it.itemId}`,
    targetWord: correct.label,
    imageUrl: correct.imageUrl,
    tiles,
    instruction: '글자를 눌러 낱말을 만들어 보세요',
    presentedLevel: level,
  };
}

/** 단어이해 문항을 무작위 count개 추출. level로 선택지 난이도를 정한다. */
export function pickWordItems(count: number, level?: number): QabImageItem[] {
  return shuffle(WORD_ITEMS)
    .slice(0, Math.max(0, count))
    .map((it) => toWordItem(it, level));
}

/**
 * 문장이해 난이도 축 — **통사 복잡도**.
 *
 * 문장이해에서 오답거리를 조절할 수 없는 건 선택지가 원본 JSON의 고정 쌍이기
 * 때문이다(toSentItem 참고). 대신 자극 자체에 이미 축이 들어 있다 — `sentenceType`.
 *
 * 실어증 문장이해의 복잡도 위계는 확립돼 있다:
 *   active-passive   능동/수동 가역문 — 어순 단서만으로는 못 풀지만 절이 하나다
 *   relative-clause  관계절 — 논항이 원위치를 벗어나 흔적 처리가 필요하다
 *   embedded-clause  내포절 — 절 경계를 유지한 채 처리해야 해 작업기억 부담이 최대
 *
 * 예전에는 presentedLevel을 스탬핑만 하고 문항 구성은 레벨과 무관했다. 그러면
 * "레벨 5 정답률"이 실제로는 레벨 1과 같은 문항의 정답률이라, 보호자가 보는
 * 눈높이가 회복을 뜻하지 않게 된다.
 */
const SENT_TYPES_BY_LEVEL: Record<number, readonly string[]> = {
  1: ['active-passive'],
  2: ['active-passive'],
  3: ['active-passive', 'relative-clause'],
  4: ['active-passive', 'relative-clause'],
  5: ['active-passive', 'relative-clause', 'embedded-clause'],
};

/** 이 레벨에서 낼 수 있는 통사 유형. (테스트 노출) */
export function sentTypesForLevel(level?: number): readonly string[] {
  return SENT_TYPES_BY_LEVEL[normalizeLevel(level, COLD_START_LEVEL)];
}

/**
 * 레벨이 허용하는 통사 유형만 남긴다. 모자라면 전체 풀로 되돌려
 * 세션이 비지 않게 한다(난이도가 어긋나는 편이 문항이 사라지는 것보다 낫다).
 */
function sentPoolForLevel(want: number, level?: number): RawSentItem[] {
  const allowed = new Set(sentTypesForLevel(level));
  const eligible = SENT_ITEMS.filter((it) => allowed.has(it.sentenceType));
  return eligible.length >= want ? eligible : [...SENT_ITEMS];
}

/** 문장이해 문항을 무작위 count개 추출. */
export function pickSentItems(count: number, level?: number): QabImageItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  return shuffle(sentPoolForLevel(want, level))
    .slice(0, want)
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
    // 문장은 레벨이 허용하는 통사 유형만 — 단어처럼 오답거리를 조절할 수 없는
    // 대신 자극의 복잡도로 난이도를 준다.
    ...sentPoolForLevel(count, levels?.sentence).map((it) =>
      toSentItem(it, levels?.sentence),
    ),
  ];
  return shuffle(pool).slice(0, Math.max(0, count));
}

/** 뱅크 문항 수 (단어/문장 합계) */
export function qabItemCount(): number {
  return WORD_ITEMS.length + SENT_ITEMS.length;
}
