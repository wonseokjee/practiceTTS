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
import { shuffle } from '../../../../shared/domain/shuffle.js';
import {
  choiceSpecForLevel,
  distractorCountForLevel,
  sentChoiceTotalForLevel,
  sentTypeForLevel,
  syllableCount,
  syllableRangeForLevel,
  usesSimilarDistractors,
} from '../domain/difficultyRules.js';
import namingPhotos from '../../../../assets/data/namingPhotos.json';
import namingOnlyWords from '../../../../assets/data/namingOnlyWords.json';
import sentCompData from '../../../../assets/data/sentCompItems.json';
// 거울 문항(정답/오답 반전)으로 문장이해 풀을 새 이미지 없이 2배로 확장한다.
import sentMirrorData from '../../../../assets/data/qabSentMirror.json';
// AI 이미지 생성 스크립트(scripts/generate_sentcomp_images.py)가 만든 신규 장면 문항.
// 이미지가 생성된 항목만 포함되며, 스크립트 실행 전에는 비어 있다.
import sentGeneratedData from '../../../../assets/data/qabSentGenerated.json';
// 관계절 문항. 기존 가역문 장면 쌍을 그대로 쓰고 문장만 새로 쓴다(새 그림 0장).
import sentRelativeData from '../../../../assets/data/qabSentRelative.json';
// 내포절 문항. 사람과 자세는 같고 생각 풍선 속만 다른 장면 쌍을 쓴다.
import sentEmbeddedData from '../../../../assets/data/qabSentEmbedded.json';
import type {
  QabImageChoice,
  QabImageItem,
  QabNamingItem,
  QabSpellItem,
  QabFoilKind,
} from '../domain/MixedQuiz.js';
import {
  sharesInitialConsonant,
  sharesOnsetOrNucleus,
} from '../../../../shared/domain/korean.js';

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

/**
 * 혼합 퀴즈 풀에서 빼는 문장 문항 — **관계절이 놀고 있는 넷**과 그 거울.
 *
 * 넷 다 관계절을 달고 `relative-clause`로 기록됐지만, 두 그림이 관계절이
 * 아니라 주절에서만 갈린다.
 *
 *   05  "**공을 차는** 아이가 웃고 있어요"  ↔  "**공을 차는** 아이가 울고 있어요"
 *   06  "**책을 읽는** 여자가 안경을 썼어요" ↔  "…안경을 쓰지 않았어요"
 *   07  "**노래하는** 남자가 기타를 들었어요" ↔ "…드럼을 들었어요"
 *   08  "**뛰어가는** 강아지가 공을 물었어요" ↔ "…뼈를 물었어요"
 *
 * 굵은 부분이 두 선택지에서 똑같다. 관계절을 통째로 흘려들어도 정답을 고른다.
 * 그런데 레벨 3~4가 내는 유형이 `relative-clause`라, 이 넷이 "관계절 정답률"로
 * 기록되고 적응 레벨링이 그 값을 보고 승급을 판단했다.
 *
 * **고칠 방법이 없어서 뺀다.** 관계절이 일하게 하려면 그림에 후보가 둘 있어야
 * 한다(공을 **차는** 아이와 **든** 아이가 한 그림에). 지금 그림에는 아이가
 * 하나뿐이라, 문장을 고쳐서는 안 되고 그림을 새로 그려야 한다.
 *
 * 그래도 **문항 수는 그대로다** — 같은 수의 진짜 관계절 문항을 새 그림 없이
 * 만들어 넣었다(`qabSentRelative.json`).
 *
 * 표준 sentComp 검사(`useSentCompViewModel`)에서는 그대로 쓴다. 거기서는
 * 통사 유형이 난이도 손잡이가 아니라 문항일 뿐이고, 넷 다 멀쩡한 문항이다.
 */
const NON_DISCRIMINATIVE_SENT_ITEMS: ReadonlySet<string> = new Set([
  'sentComp_05', 'sentComp_06', 'sentComp_07', 'sentComp_08',
  'sentComp_05_m', 'sentComp_06_m', 'sentComp_07_m', 'sentComp_08_m',
]);

/**
 * 혼합 퀴즈 풀에서 빼는 문장 문항 — **내포절 밴드에 있는 단문 둘.**
 *
 *   09  아빠는 엄마가 요리를 한다고 생각해요   ← 내포절
 *   09_m 아빠가 혼자 요리를 하고 있어요        ← **단문**
 *   10  선생님은 학생이 공부를 잘한다고 믿어요 ← 내포절
 *   10_m 학생이 선생님을 믿고 있어요           ← **단문**
 *
 * 거울 문항이 내포절이 아니다. 09·10의 그림 쌍이 역할 뒤집기가 아니라
 * "떠올린다 ↔ 실제로 한다"의 대비라, 오답 그림을 가리키는 문장이 자연히
 * 단문이 된다. 그런데 둘 다 `embedded-clause`로 기록돼, 레벨 5가 내는 넷 중
 * 둘이 단문이었다 — **"레벨 5 정답률"의 절반이 단문 정답률이었다.**
 *
 * 대신 내포절끼리 갈리는 장면 둘을 새로 그려 넣었다(`qabSentEmbedded.json`).
 * 밴드는 4개에서 6개로 늘었다.
 *
 * 표준 sentComp 검사에서는 그대로 쓴다 — 거기서는 통사 유형이 난이도
 * 손잡이가 아니다.
 */
const NON_EMBEDDED_MIRRORS: ReadonlySet<string> = new Set([
  'sentComp_09_m',
  'sentComp_10_m',
]);

const SENT_ITEMS: RawSentItem[] = [
  ...(sentCompData as unknown as RawSentItem[]),
  ...((sentMirrorData as { items: RawSentItem[] }).items),
  ...((sentGeneratedData as { items: RawSentItem[] }).items),
  ...((sentRelativeData as { items: RawSentItem[] }).items),
  ...((sentEmbeddedData as { items: RawSentItem[] }).items),
].filter(
  (it) =>
    !NON_DISCRIMINATIVE_SENT_ITEMS.has(it.itemId) &&
    !NON_EMBEDDED_MIRRORS.has(it.itemId),
);

const WORD_INSTRUCTION = '들려주는 단어의 그림을 골라주세요';
const SENT_INSTRUCTION = '들려주는 문장에 맞는 그림을 골라주세요';
const NAMING_INSTRUCTION = '그림을 보고 이름을 말해주세요';


// ── 통제된 유인지(distractor) 생성 ─────────────────────────────
//
// 기존에는 오답지가 문항 JSON에 무작위 무관 단어로 박혀 있어, 같은 범주 유인지가
// 없으면 소거법으로 다 맞아 변별력이 없었다(예: 비행기 ↔ 바나나·우체통).
// 표준 실어증 검사(K-WAB, BNT)처럼 "같은 의미 범주 2 + 무관 1"로 유인지를
// 구성해, 범주만 알면 못 맞추고 '정확히 그 단어'를 이해해야 맞도록 만든다.

/**
 * slug → 의미 범주. **범주가 없는 낱말은 `null`이다.** (테스트 노출)
 *
 * 범주는 두 곳에서 쓰인다. 검사에서는 `buildControlledChoices`가 **같은 범주
 * 오답**을 뽑는 기준이고, 연습에서는 무리에서 빼기가 **한 무리로 묶을 수 있는가**의
 * 기준이다. 두 쓰임 다 "이 셋은 한 무리"가 사람 눈에 참이어야 한다.
 *
 * 2026-08-22에 `object`(34개)를 쪼갰다. 촛불·소파·숟가락을 셋 놓고 "다른 하나"를
 * 물으면 정답이 하나로 안 정해졌고, 검사 쪽에서도 숟가락의 "같은 범주 오답"이
 * 풍선·돌이라 범주가 이름만 범주였다. 쪼갠 뒤에는 숟가락의 오답이 칼·주전자가
 * 되어 정말로 그 낱말을 알아야 맞는다.
 *
 * **레벨 4~5는 이 낱말들에서 조금 쉬워진다.** 오답 3개를 전부 같은 범주로 채우려면
 * 범주에 넷 이상이 필요한데, 주방·욕실·연장·가구·악기·가전은 셋뿐이라 모자란
 * 자리를 무관 낱말로 채운다. 쪼개기 전에는 `object`가 34개라 셋이 늘 찼지만 그
 * 셋이 서로 무관했으니, 이름만 어려웠던 것을 진짜 쉬운 것으로 바꾼 셈이다.
 * 넷을 채우려면 낱말을 더 넣어야 한다(docs/ASSETS-NEEDED.md).
 *
 * 그림 고르기용 아이콘이 없는 낱말의 태그는 두지 않는다. 2026-08-22에 Fluent
 * 교체로 아이콘이 사라진 16개를 지웠다.
 *
 * **그중 빗·책상·수건·냉장고는 돌아왔다.** #71이 실물 사진을 붙여 이름대기
 * 전용으로 되살렸다(namingOnlyWords). 아이콘이 없으니 여기 오답 후보로는 여전히
 * 못 쓰지만 "어디서도 안 쓰인다"는 이제 거짓이다. 국자·모래·세탁기·비누통은
 * 아직 어디에도 없다.
 */
export const WORD_CATEGORY: Record<string, string | null> = {
  // 동물 12
  bear: 'animal', butterfly: 'animal', cat: 'animal', chick: 'animal',
  dog: 'animal', elephant: 'animal', lion: 'animal', pig: 'animal',
  rabbit: 'animal', tiger: 'animal', turtle: 'animal', whale: 'animal',
  // 음식 16
  apple: 'food', banana: 'food', bread: 'food', cake: 'food', candy: 'food',
  carrot: 'food', corn: 'food', grape: 'food', juice: 'food', melon: 'food',
  milk: 'food', orange: 'food', strawberry: 'food', sweet_potato: 'food',
  tomato: 'food',
  watermelon: 'food',
  // 탈것 7
  airplane: 'vehicle', bicycle: 'vehicle', bus: 'vehicle', car: 'vehicle',
  ship: 'vehicle', train: 'vehicle', truck: 'vehicle',
  // 식물 4
  cactus: 'plant', flower: 'plant', mushroom: 'plant', tree: 'plant',
  // 장소 6 — 여섯 다 그림에 건물이 보인다. 도서관·수영장은 아이콘이 책 더미와
  // 헤엄치는 사람이라 셋을 늘어놓아도 한 무리로 안 보였다. 사진은 멀쩡하므로
  // 이름대기 전용으로 옮기고(namingOnlyWords) 우체국·백화점을 넣었다(TODO-115).
  bank: 'place', department_store: 'place', hospital: 'place',
  house: 'place', post_office: 'place', school: 'place',
  // 신체 6
  ear: 'body', eye: 'body', foot: 'body', hand: 'body', mouth: 'body',
  nose: 'body',
  // 사람 4
  baby: 'person', doctor: 'person', firefighter: 'person', student: 'person',
  // 옷·착용 5
  glasses: 'clothing', gloves: 'clothing', hat: 'clothing', shoes: 'clothing',
  socks: 'clothing',
  // 문구 4
  book: 'stationery', notebook: 'stationery', pencil: 'stationery',
  scissors: 'stationery',
  // 가구 3
  bed: 'furniture', chair: 'furniture', couch: 'furniture',
  // 악기 3
  guitar: 'instrument', piano: 'instrument', trumpet: 'instrument',
  // 가전 3
  computer: 'appliance', phone: 'appliance', television: 'appliance',
  // 주방 3
  kettle: 'kitchen', knife: 'kitchen', spoon: 'kitchen',
  // 욕실 3
  mirror: 'bathroom', soap: 'bathroom', toothbrush: 'bathroom',
  // 연장 3
  hammer: 'tool', ladder: 'tool', screwdriver: 'tool',
  // ── 범주 없음 9 ───────────────────────────────────────────────
  //
  // 서로 한 무리가 아니다. 예전에는 이 아홉을 `'object'`라는 이름의 범주로 묶어
  // 뒀는데, 그러면 `buildControlledChoices`가 가방의 "같은 범주 오답"으로 풍선·돌을
  // 뽑고 그 행에 `foil_kind='semantic'`을 찍었다. 91개 중 9개(9.9%)가 **거짓
  // 의미 오답**이었다.
  //
  // 갈래를 나눈 이유가 "의미 오답을 반복해 고르는 것과 음운 오답을 반복해 고르는
  // 것은 서로 다른 손상"을 읽기 위해서인데, 이름만 범주인 묶음이 그 신호를
  // 오염시킨다. `null`로 두면 이 낱말들은 의미 오답을 **못 가지고**, 그 자리는
  // 음운 오답으로 넘어간다(아래 buildControlledChoices).
  //
  // "다른 하나"(연습)로는 얼마든지 쓴다 — 동물 셋 사이의 열쇠는 명확하다.
  bag: null, balloon: null, basket: null, candle: null,
  clock: null, key: null, mailbox: null, rock: null,
  umbrella: null,
};

/**
 * 두 낱말이 **같은 의미 범주**인가.
 *
 * `null === null`을 참으로 보면 안 된다. 범주 없음끼리는 "둘 다 무리가 아니다"라는
 * 뜻이지 같은 무리라는 뜻이 아니다.
 */
function sameCategory(a: string | null, b: string | null): boolean {
  return a !== null && a === b;
}

export interface MasterWord {
  slug: string;
  label: string;
  imageUrl: string;
  /** 의미 범주. `null`이면 어느 무리에도 안 든다(의미 오답을 못 가진다). */
  category: string | null;
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
      // 미등록 slug는 폴백하지 않고 `null`로 둔다. 예전엔 `?? 'object'`라
      // 태그를 빠뜨린 낱말이 조용히 잡동사니 범주에 섞였다. 풀의 모든 slug가
      // 등록돼 있다는 것은 테스트가 지킨다(`풀 ⊆ WORD_CATEGORY`).
      category: slug in WORD_CATEGORY ? WORD_CATEGORY[slug] : null,
    });
  }
  return [...bySlug.values()];
})();

/**
 * 마스터 낱말 풀 읽기 접근자 (낱말 + 범주 + 그림).
 *
 * 연습 모드가 그림선택 말고 다른 양식(무리에서 빼기, 범주 분류)을 조립할 때
 * 필요한 최소 재료다. `buildControlledChoices`가 이미 이 풀을 유인지 후보로
 * 쓰고 있으므로 새 개념이 아니라 이미 있던 것을 밖에서 볼 수 있게 하는 것뿐이다.
 *
 * 배열을 그대로 넘기지 않고 복사본을 준다 — 호출자가 정렬·셔플해도 뱅크의
 * 원본이 흔들리지 않게.
 */
export function masterWords(): MasterWord[] {
  return [...MASTER_WORDS];
}

// ── 레벨별 렌더 난이도 스펙 ─────────────────────────────────────
//
// 그림선택 난이도는 항목 자체가 아니라 "렌더 시점의 오답 구성"으로 정한다.
// 같은 항목도 환자의 현재 레벨에 따라 다르게 제시한다. 두 축으로 단조 증가:
//   - total  : 선택지 총 개수(많을수록 부담↑, 소거 어려움↑)
//   - sameCat: 같은 의미 범주 오답 수(많을수록 범주만으론 못 맞춤 → 변별↑)
// 낮은 레벨은 선택지 적고 오답이 무관(먼) 단어라 쉽고, 높은 레벨은 선택지 많고
// 오답이 전부 같은 범주(근접)라 어렵다.
/**
 * 통제된 유인지를 골라 정답과 함께 레벨별 보기를 만든다.
 *
 * 오답은 세 갈래로 채운다 — **의미**(같은 범주) → **음운**(다른 범주, 첫 음절이
 * 닮음) → **무관**(나머지). 순서가 곧 우선순위다. {@link LEVEL_CHOICE_SPEC}에
 * 레벨별 배분이 있다.
 *
 * level 미지정 시 콜드스타트 레벨 2(의미1 + 무관1) — 다른 축과 같은 값이다.
 */
export function buildControlledChoices(target: MasterWord, level?: number) {
  const spec = choiceSpecForLevel(level);
  const foilTotal = Math.max(0, spec.total - 1);
  const sameCatWanted = Math.min(spec.sameCat, foilTotal);

  const sameCat = shuffle(
    MASTER_WORDS.filter(
      (w) => w.slug !== target.slug && sameCategory(w.category, target.category),
    ),
  );
  // `w.slug !== target.slug`를 여기서도 건다. 예전엔 범주 비교만으로 자기 자신이
  // 걸러졌는데(자기 범주는 늘 같으니까), 범주 없음(null)끼리는 "같은 범주"가
  // 아니므로 정답이 자기 오답 후보에 들어온다.
  const otherCat = shuffle(
    MASTER_WORDS.filter(
      (w) =>
        w.slug !== target.slug && !sameCategory(w.category, target.category),
    ),
  );

  // 갈래를 **뽑는 자리에서** 붙여 들고 다닌다. 나중에 되짚으면 같은 낱말이 두
  // 조건을 동시에 만족할 때 실제로 어느 통에서 왔는지와 어긋난다.
  const foils: Array<{ word: MasterWord; kind: QabFoilKind }> = [];
  const has = (w: MasterWord) => foils.some((f) => f.word.slug === w.slug);
  // 같은 범주(부족하면 그만큼만)
  foils.push(
    ...sameCat
      .slice(0, sameCatWanted)
      .map((w) => ({ word: w, kind: 'semantic' as const })),
  );

  // ── 음운 유인지 ────────────────────────────────────────────────
  //
  // **다른 범주에서만 뽑는다.** 의미와 음운이 한 오답에 겹치면 환자가 그걸
  // 골랐을 때 의미에서 틀린 건지 소리에서 틀린 건지 읽을 수 없다. 두 축을
  // 나눈 목적이 바로 그 구분이다.
  //
  // 1순위는 첫 음절 초성이 같은 낱말('사과'→'사자'). 어두 음소가 겹쳐야 진짜
  // 유인지다. 초성이 유일한 낱말(꽃·빵)은 1순위 후보가 0개라, 초성이나 중성을
  // 공유하는 2순위로 내려가 채운다 — 개수를 줄이면 문항만 쉬워지고 기록은
  // 그대로라 레벨이 거짓말을 한다.
  // 같은 범주가 모자란 만큼 **음운 자리로 넘긴다.** 무관으로 흘려보내면 문항만
  // 쉬워지고 기록은 그대로라 레벨이 거짓말을 한다. 음운 오답은 90개 낱말 전부가
  // 채울 수 있으므로(초성 1순위, 없으면 초·중성 2순위) 이 이동은 늘 성립한다.
  const sameCatShort = sameCatWanted - foils.length;
  const phonWanted = Math.min(
    spec.phon + sameCatShort,
    foilTotal - foils.length,
  );
  if (phonWanted > 0) {
    const pool = otherCat.filter((w) => !has(w));
    const near = shuffle(
      pool.filter((w) => sharesInitialConsonant(target.label, w.label)),
    );
    const loose = shuffle(
      pool.filter(
        (w) =>
          !sharesInitialConsonant(target.label, w.label) &&
          sharesOnsetOrNucleus(target.label.charAt(0), w.label.charAt(0)),
      ),
    );
    foils.push(
      ...[...near, ...loose]
        .slice(0, phonWanted)
        .map((w) => ({ word: w, kind: 'phonological' as const })),
    );
  }

  for (const w of otherCat) {
    // 무관 오답으로 나머지를 채운다(같은 범주가 모자랄 때도 여기서 보충).
    if (foils.length >= foilTotal) break;
    if (!has(w)) foils.push({ word: w, kind: 'unrelated' });
  }
  // 그래도 부족하면(풀이 아주 작을 때) 아무거나 채운다. 이때만 같은 범주가
  // 무관 자리에 올 수 있어, 갈래는 실제 범주를 보고 정한다.
  if (foils.length < foilTotal) {
    for (const w of shuffle(MASTER_WORDS)) {
      if (foils.length >= foilTotal) break;
      if (w.slug !== target.slug && !has(w)) {
        foils.push({
          word: w,
          kind: sameCategory(w.category, target.category)
            ? 'semantic'
            : 'unrelated',
        });
      }
    }
  }

  const raw = [
    {
      slug: target.slug,
      label: target.label,
      imageUrl: target.imageUrl,
      isCorrect: true,
      kind: undefined as QabFoilKind | undefined,
    },
    ...foils.slice(0, foilTotal).map((f) => ({
      slug: f.word.slug,
      label: f.word.label,
      imageUrl: f.word.imageUrl,
      isCorrect: false,
      kind: f.kind as QabFoilKind | undefined,
    })),
  ];
  return shuffle(raw).map((c, idx) => ({
    choiceId: `${target.slug}_c${idx}`,
    label: c.label,
    imageUrl: c.imageUrl,
    isCorrect: c.isCorrect,
    ...(c.kind !== undefined ? { foilKind: c.kind } : {}),
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

/**
 * 이미지가 속한 **장면**. `sentComp_03_distractor.png` → `sentComp_03`.
 *
 * 미러 문항(`sentComp_03_m`)은 원본과 **같은 두 장**을 정답만 바꿔 쓴다. 그래서
 * "다른 문항의 이미지"로 오답을 고르면 자기 장면이 되돌아온다 — itemId가 아니라
 * 장면으로 걸러야 하는 이유다.
 */
export function sceneOfImage(imageUrl: string): string {
  const file = imageUrl.split('/').pop() ?? imageUrl;
  return file.replace(/\.[^.]+$/, '').replace(/_(correct|distractor)$/, '');
}

/**
 * 문장이해 보기를 레벨이 요구하는 수만큼 채운다.
 *
 * 원본 JSON은 문항마다 **두 장**이다 — 정답과 역할역전 오답. 그 둘은 그대로 두고
 * (역할역전이 가역문 이해를 재는 핵심이다), 모자란 자리는 **다른 장면**에서
 * 빌려 온다. 새 그림은 필요 없다: 14개 장면 × 2장이 이미 있고 자기 장면만
 * 빼면 13개가 남는다.
 *
 * 무관 오답을 섞는 건 임시방편이 아니라 실어증 문장이해 검사의 표준 배열이다
 * (정답 + 역할역전 + 무관). 지금의 2지선다가 오히려 표준에서 모자란 쪽이었다.
 *
 * **한 장면에서 한 장만 가져온다.** 같은 장면의 두 장은 행위자·대상만 뒤바뀐
 * 거의 같은 그림이라, 둘 다 들어가면 환자는 무관한 그림을 두 번 훑어야 하고
 * 보기 한 자리를 버리게 된다.
 */
export function buildSentChoices(
  it: RawSentItem,
  pool: readonly RawSentItem[],
  level?: number,
  rng: () => number = Math.random,
): QabImageChoice[] {
  const own = it.choices.map((c, idx) => ({
    choiceId: `${it.itemId}_c${idx}`,
    label: c.altText,
    imageUrl: c.imageUrl,
    isCorrect: c.isCorrect,
  }));

  const ownScenes = new Set(it.choices.map((c) => sceneOfImage(c.imageUrl)));
  const wanted = sentChoiceTotalForLevel(level) - own.length;

  // 장면당 한 장만 후보에 올린다. 먼저 만난 것을 남기되, 어느 장면이 먼저
  // 오는지는 아래 shuffle이 정하므로 특정 그림이 고정으로 뽑히지 않는다.
  const seen = new Set<string>(ownScenes);
  const candidates: QabImageChoice[] = [];
  for (const other of shuffle(pool, rng)) {
    for (const c of other.choices) {
      const scene = sceneOfImage(c.imageUrl);
      if (seen.has(scene)) continue;
      seen.add(scene);
      candidates.push({
        choiceId: `${it.itemId}_x_${scene}`,
        label: c.altText,
        imageUrl: c.imageUrl,
        isCorrect: false,
      });
    }
  }

  // 후보가 모자라면 있는 만큼만. 자극이 줄어드는 것보다 보기가 적은 편이 낫다.
  return shuffle([...own, ...candidates.slice(0, Math.max(0, wanted))], rng);
}

function toSentItem(
  it: RawSentItem,
  level?: number,
  pool: readonly RawSentItem[] = SENT_ITEMS,
): QabImageItem {
  // 문장이해의 **1차** 난이도 축은 여전히 자극의 통사 복잡도다(sentPoolForLevel).
  // 보기 수는 우연수준을 낮추려고 뒤에 붙인 2차 축이다 —
  // 근거는 difficultyRules의 sentChoiceTotalForLevel에 적어 뒀다.
  return {
    itemId: it.itemId,
    category: 'sentence',
    promptText: it.sentence,
    instruction: SENT_INSTRUCTION,
    choices: buildSentChoices(it, pool, level),
    presentedLevel: level,
  };
}

/** 실물 사진이 준비된 단어 slug 집합. */
const NAMING_PHOTO_SLUGS = new Set<string>(namingPhotos.slugs);

/**
 * 이름대기 전용 낱말 — 사진은 있으나 그림 고르기용 아이콘이 없는 것들.
 *
 * **왜 낱말 풀에 안 넣나.** 풀(`qabWordPool`)은 4지선다를 전제해 정답에 SVG를
 * 요구한다. 사진으로 대신할 수 없다 — 한 선택지만 사진이면 낱말을 몰라도 그것만
 * 골라 다 맞아 그 문항이 '사진 찾기'가 된다.
 *
 * 이름대기는 자극이 한 장뿐이라 선택지 격자가 없고, 따라서 SVG도 필요 없다.
 * 그 비대칭을 자료로 드러낸다 — 예전에는 이름대기가 선택지 풀에 얹혀 있어서
 * 아이콘 없는 낱말은 사진이 있어도 쓸 수 없었다.
 *
 * **`MASTER_WORDS`에는 안 들어간다.** 그림 고르기의 정답으로도 오답으로도 나오면
 * 안 되므로, 범주 크기(욕실·가구·가전)에도 영향을 주지 않는다.
 */
const NAMING_ONLY_ITEMS: QabNamingItem[] = namingOnlyWords.items.map((w) => ({
  itemId: `naming_only_${w.slug}`,
  imageUrl: `/assets/images/naming/${w.slug}.png`,
  targetWord: w.label,
  instruction: NAMING_INSTRUCTION,
  // 이 넷은 애초에 사진만 남은 낱말이다(Fluent 교체 때 아이콘이 사라졌다).
  stimulusKind: 'photo',
  // 이쪽 JSON은 범주를 자기 안에 들고 있다(WORD_CATEGORY와 별개).
  category: w.category,
}));

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
 * 구현: **사진이 있는 낱말만 낸다.** 없으면 null이라 이름대기에 안 나온다.
 *
 * 예전에는 사진이 없으면 단어이해 SVG로 폴백했다. 사진이 67/84뿐이던 때는
 * 그게 맞았다 — 폴백을 없앴다면 한 세션을 채울 문항이 모자랐다. 지금은
 * 90/95라, 다섯을 빼도 통이 넉넉하다.
 *
 * 폴백을 없애는 쪽이 나은 이유는 재는 값이 깨끗해지기 때문이다. 실물 사진과
 * 만화풍 아이콘은 이름을 떠올리는 난이도가 다르다. 섞여 나오면 이름대기
 * 정답률이 "낱말을 아는 정도"가 아니라 "그날 어떤 자극이 뽑혔는가"에 흔들린다.
 * `stimulusKind`로 기록은 남겼지만(E11), 기록은 교란을 설명할 뿐 없애지는
 * 못한다. 이제 자극이 한 종류라 그 교란 자체가 사라진다.
 *
 * 빠지는 다섯(텔레비전·당근·코·학교·은행)은 단어이해에는 그대로 남는다.
 * 거기서는 SVG가 폴백이 아니라 원래 맞는 자극이다.
 */
function toNamingItem(it: RawWordItem, level?: number): QabNamingItem | null {
  const correct = it.choices.find((c) => c.isCorrect);
  if (!correct) return null;
  const slug = slugFromUrl(correct.imageUrl);
  if (!NAMING_PHOTO_SLUGS.has(slug)) return null;
  return {
    itemId: `naming_${it.itemId}`,
    imageUrl: `/assets/images/naming/${slug}.png`,
    targetWord: it.targetWord,
    instruction: NAMING_INSTRUCTION,
    presentedLevel: level,
    stimulusKind: 'photo',
    // 단서 위계(E18)가 의미 단서를 만들 때 쓴다. 값은 이미 여기 있었는데
    // 문항에 안 실려서 화면이 못 쓰고 있었다.
    category: slug in WORD_CATEGORY ? WORD_CATEGORY[slug] : null,
  };
}

/**
 * 그림 이름대기 문항을 무작위 count개 추출.
 *
 * **레벨 인자를 받지 않는다.** 예전엔 받아서 `presentedLevel`에 찍기만 했다 —
 * 문항 선택에는 전혀 쓰이지 않아 레벨 1과 5가 같은 문항을 냈고, 그 값이 서버에
 * 저장돼 보호자 화면에 눈높이 단계로 표시됐다. 없는 사실을 만들지 않으려면
 * 스탬핑도 하면 안 된다. 자세한 이유는 {@link NON_LEVELED_SUBTESTS}.
 */
export function pickNamingItems(
  count: number,
  options?: PickQabOptions,
): QabNamingItem[] {
  const fromPool = WORD_ITEMS.map((it) => toNamingItem(it, undefined)).filter(
    (x): x is QabNamingItem => x !== null,
  );
  // 전용 낱말도 같은 통에 넣고 함께 섞는다. 뒤에 붙이면 count가 작을 때 영영
  // 안 나온다.
  const namingOnly = NAMING_ONLY_ITEMS.map((it) => ({
    ...it,
    presentedLevel: undefined,
  }));
  const all = [...fromPool, ...namingOnly];
  const want = Math.max(0, count);
  const excluded = options?.exclude;
  const fresh = excluded ? all.filter((it) => !excluded.has(it.itemId)) : all;
  const pool = fresh.length >= want ? fresh : all;
  return shuffle(pool).slice(0, want);
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
 * 목표 단어를 음절로 쪼개고 방해 음절을 섞어 셔플한 타일을 만든다.
 * 정답 음절의 중복은 보존한다(예: '바나나' → 바·나·나).
 *
 * 최고 레벨에서는 정답 음절과 초성·중성을 공유하는 방해 타일을 **먼저** 쓴다.
 * 닮은 후보가 모자라면 나머지를 무작위로 채운다 — 개수를 줄이면 레벨이 약속한
 * 난도보다 쉬워지고, 그 문항이 레벨 5로 기록된다.
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
  const pool = SPELL_DISTRACTOR_POOL.filter((s) => !answerSet.has(s));
  const ranked = usesSimilarDistractors(level)
    ? [
        ...shuffle(
          pool.filter((s) => answer.some((a) => sharesOnsetOrNucleus(s, a))),
          rng,
        ),
        ...shuffle(
          pool.filter((s) => !answer.some((a) => sharesOnsetOrNucleus(s, a))),
          rng,
        ),
      ]
    : shuffle(pool, rng);
  return shuffle([...answer, ...ranked.slice(0, wanted)], rng);
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
  //
  // **우선순위(재출제)는 이 범위를 못 넘는다.** 최근에 틀린 문항이라도 지금
  // 레벨의 음절 범위 밖이면 후보에 없어 그냥 빠진다. 끌어올리면 환자가 푼
  // 난이도와 `presentedLevel`이 어긋나는데, 그 어긋남이 적응 레벨링이 없애려는
  // 교란 그 자체다 — 재출제보다 레벨이 세다.
  const fellBack = eligible.length < want;
  const pool = fellBack
    ? WORD_ITEMS.filter((it) => {
        const label = labelOf(it);
        return label.length > 0 && !excluded.has(label) && syllableCount(label) >= 2;
      })
    : eligible;

  const ordered = shuffle(pool).sort((a, b) => {
    const ra = priorityRank.get(refOf(a)) ?? Number.MAX_SAFE_INTEGER;
    const rb = priorityRank.get(refOf(b)) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });

  const picked: QabSpellItem[] = [];
  for (const it of ordered) {
    if (picked.length >= want) break;
    const item = toSpellItem(it, level);
    // 되돌림으로 나온 문항은 presentedLevel이 실제 음절 난이도를 뜻하지 않는다(D3).
    if (item !== null) picked.push(fellBack ? { ...item, bandFallback: true } : item);
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

/**
 * `pickWordItems`·`pickSentItems`·`pickNamingItems`가 같이 쓰는 옵션.
 *
 * `PickSpellOptions.exclude`(같은 세션 안, 낱말 문자열)와는 다른 개념이다 —
 * 여기 `exclude`는 **문항 식별자**이고 **세션을 넘어** 최근 며칠을 가리킨다.
 * 목적도 반대다: spell의 재출제(priority)는 치료를 위해 겹침을 **일부러**
 * 만들고, 이 exclude는 정답률이 이해력을 재도록 겹침을 **막는다**(측정용
 * 세 검사 — 낱말·문장·이름대기 — 에서만 쓴다). `GET /quiz/recent-items`가
 * 돌려주는 itemRef가 각 뱅크의 itemId와 그대로 같다(접두사 변환 없음).
 */
export interface PickQabOptions {
  exclude?: ReadonlySet<string>;
}

/** 단어이해 문항을 무작위 count개 추출. level로 선택지 난이도를 정한다. */
export function pickWordItems(
  count: number,
  level?: number,
  options?: PickQabOptions,
): QabImageItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  const excluded = options?.exclude;
  // 최근에 낸 것을 뺀다 — 정답률이 이해력이 아니라 그 문항의 암기도를 재지
  // 않게(다양성이 목적이다, spell의 우선 재출제와는 반대 방향). 빼고 나서
  // 모자라면 전체 풀로 되돌린다 — 빈 세션보다 겹침이 낫다(D3와 같은 원칙).
  const fresh = excluded
    ? WORD_ITEMS.filter((it) => !excluded.has(it.itemId))
    : WORD_ITEMS;
  const pool = fresh.length >= want ? fresh : WORD_ITEMS;
  return shuffle(pool)
    .slice(0, want)
    .map((it) => toWordItem(it, level));
}

/**
 * 문장이해 난이도 축 — **통사 복잡도**.
 *
 * 문장이해에서 오답거리를 조절할 수 없는 건 선택지가 원본 JSON의 고정 쌍이기
 * 때문이다(toSentItem 참고). 대신 자극 자체에 이미 축이 들어 있다 — `sentenceType`.
 *
 * 실어증 문장이해의 복잡도 위계는 확립돼 있다:
 *   reversible       가역문 — 어순으로만 행위자·대상이 갈리고 절이 하나다
 *   relative-clause  관계절 — 논항이 원위치를 벗어나 흔적 처리가 필요하다
 *   embedded-clause  내포절 — 절 경계를 유지한 채 처리해야 해 작업기억 부담이 최대
 *
 * 예전에는 presentedLevel을 스탬핑만 하고 문항 구성은 레벨과 무관했다. 그러면
 * "레벨 5 정답률"이 실제로는 레벨 1과 같은 문항의 정답률이라, 보호자가 보는
 * 눈높이가 회복을 뜻하지 않게 된다.
 */
/**
 * 이 레벨의 통사 유형만 남긴다. 모자라면 전체 풀로 되돌려 세션이 비지 않게
 * 한다(난이도가 어긋나는 편이 문항이 사라지는 것보다 낫다).
 *
 * 가장 얇은 밴드가 내포절 **20문항**이다. 최근에 낸 것을 뺀 뒤에도 채울 수
 * 있으면 그대로 쓰고, 밴드 자체가 얇거나 exclude가 밴드를 비우면 **2단으로**
 * 되돌린다 — 먼저 exclude만 풀어 같은 레벨 안에서 채우고(정답률의 뜻은
 * 그대로다, 겹침만 허용), 그래도 모자라면 레벨째 되돌린다(D3, `bandFallback`).
 * 겹침 하나로 곧장 다른 레벨을 내면 안 잰 것을 잰 척하게 된다.
 */
function sentPoolForLevel(
  want: number,
  level?: number,
  excluded?: ReadonlySet<string>,
): { pool: RawSentItem[]; fellBack: boolean } {
  const type = sentTypeForLevel(level);
  const eligible = SENT_ITEMS.filter((it) => it.sentenceType === type);
  const fresh = excluded
    ? eligible.filter((it) => !excluded.has(it.itemId))
    : eligible;
  if (fresh.length >= want) return { pool: fresh, fellBack: false };
  if (eligible.length >= want) return { pool: eligible, fellBack: false };
  return { pool: [...SENT_ITEMS], fellBack: true };
}

/** 문장이해 문항을 무작위 count개 추출. */
export function pickSentItems(
  count: number,
  level?: number,
  options?: PickQabOptions,
): QabImageItem[] {
  const want = Math.max(0, count);
  if (want === 0) return [];
  const { pool, fellBack } = sentPoolForLevel(want, level, options?.exclude);
  return shuffle(pool)
    .slice(0, want)
    .map((it) => {
      const item = toSentItem(it, level);
      // 되돌림으로 나온 문항은 presentedLevel이 실제 난이도를 뜻하지 않는다(D3).
      return fellBack ? { ...item, bandFallback: true } : item;
    });
}

/**
 * 단어/문장 이해를 섞어 count개를 추출한다(질문형 슬롯 채우기).
 * 두 뱅크를 합쳐 셔플 → count개. 한쪽이 부족하면 다른 쪽에서 더 채워진다.
 * levels로 단어/문장 각각의 제시 레벨을 지정한다(미지정 시 기존 동작=레벨 3).
 */
/**
 * QAB 슬롯 하나가 문장 이해로 갈 확률 — 낱말 90 : 문장 26.
 *
 * **레벨과 무관해야 한다.** 예전에는 문장 풀을 단어 풀과 한 통에 붓고 섞어서,
 * 레벨이 허용하는 문장 수가 곧 추첨 가중치가 됐다. 환자의 문장 레벨이 오를수록
 * 문장 문항이 더 자주 나온 것이다 — 실측으로 레벨 1~2에서 13.7%, 3~4에서 20.3%,
 * 5에서 22.7%였다. 검사 구성이 환자 실력에 따라 달라지면 하위검사끼리 비교가
 * 깨지고, 통사 유형을 바꾸는 이번 수정에서는 더 심해진다(내포절 4문항 → 4%).
 *
 * 몫은 자료가 정한다. 다른 근거가 없어 낱말과 문장의 문항 수 비를 그대로 쓴다.
 */
const SENT_SLOT_SHARE =
  SENT_ITEMS.length / (WORD_ITEMS.length + SENT_ITEMS.length);

export function pickQabItems(
  count: number,
  levels?: { word?: number; sentence?: number },
  rng: () => number = Math.random,
): QabImageItem[] {
  const want = Math.max(0, count);
  // 슬롯마다 단어/문장을 먼저 정하고, 그 다음 각 풀에서 뽑는다. 풀 크기가
  // 추첨에 새어 들어가지 않게 하는 것이 요점이다.
  let sentWanted = 0;
  for (let i = 0; i < want; i += 1) {
    if (rng() < SENT_SLOT_SHARE) sentWanted += 1;
  }
  const sent = pickSentItems(sentWanted, levels?.sentence);
  const words = pickWordItems(want - sent.length, levels?.word);
  return shuffle([...sent, ...words]);
}

/** 뱅크 문항 수 (단어/문장 합계) */
export function qabItemCount(): number {
  return WORD_ITEMS.length + SENT_ITEMS.length;
}

// 난이도 규칙은 domain/difficultyRules.ts가 집이다(D2). 기존 호출부가 뱅크에서
// 가져다 쓰고 있어 그대로 다시 내보낸다 — 규칙을 읽고 싶으면 그 파일을 본다.
export {
  COLD_START_LEVEL,
  LEVEL_CHOICE_SPEC,
  distractorCountForLevel,
  sentChoiceTotalForLevel,
  sentTypeForLevel,
} from '../domain/difficultyRules.js';
export type { ChoiceSpec } from '../domain/difficultyRules.js';
