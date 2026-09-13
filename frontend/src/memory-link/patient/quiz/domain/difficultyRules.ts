// 난이도 규칙 — **레벨(1~5) → 무엇을 얼마나 어렵게 낼 것인가.**
//
// 예전에는 이 규칙들이 두 문항 뱅크(`infrastructure/QabItemBank.ts`,
// `QabSpeechBank.ts`) 안에 문항 조립 코드와 섞여 있었다. 두 가지가 문제였다.
//
// **1. 원시 함수가 두 벌이었다.** `COLD_START_LEVEL`·`normalizeLevel`·
// `syllableCount`가 파일마다 복사돼 있었다. 값이 같아 보여도 한쪽만 고치면 조용히
// 갈라지고, 그러면 "같은 레벨인데 검사마다 다른 눈높이"가 되어 레벨별 정답률을
// 서로 비교할 수 없게 된다. 실제로 그런 적이 있다 — `normalizeLevel`의 기본값이
// 한동안 두 곳은 2, 한 곳은 3이었다(D4).
//
// **2. 규칙을 읽으려면 뱅크를 읽어야 했다.** "레벨 4가 무엇을 뜻하나"는 임상
// 판단인데 그 답이 JSON 로딩·셔플·폴백 사이에 흩어져 있었다. 여기 모으면 규칙만
// 따로 읽고 따로 검증할 수 있다.
//
// 이 파일은 **순수하다** — 자극 데이터를 읽지 않고 무작위도 쓰지 않는다. 뱅크는
// 여기서 "무엇을 낼지"를 받아 실제 문항을 만든다.

/**
 * 레벨을 모를 때 쓰는 기본값. 백엔드 `COLD_START_LEVEL`과 **같아야 한다** —
 * 다르면 환자가 본 난이도와 서버가 기록한 레벨이 어긋난다.
 */
import { languageOf } from '../../../../shared/domain/locale.js';

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;
export const COLD_START_LEVEL = 2;


/**
 * 적응 레벨을 [1..5] 정수로 정규화한다. **난이도 축이 여럿이라 반드시 공유해야 한다.**
 *
 * 예전에는 이 식(`level == null ? 기본 : clamp(round(level))`)이 세 함수에 복사돼
 * 있었고, 이미 갈라져 있었다 — 두 곳은 `COLD_START_LEVEL`(=2), 한 곳은 `3`.
 * 축마다 다른 레벨을 보면 "레벨 5인데 방해 타일은 레벨 2 수준" 같은 조합이 나오고,
 * 각 함수를 따로 검증하는 테스트로는 그 어긋남을 잡을 수 없다.
 *
 * **모든 축이 `COLD_START_LEVEL`을 쓴다.** 예전에는 그림선택만 3을 썼다 — "기존
 * 동작 보존"이 이유였는데, 그러면 레벨 조회가 실패했을 때 환자는 레벨 3 문항
 * (선택지 4개)을 보고 서버는 레벨 2로 기록한다. 본 난이도와 기록이 어긋나면
 * 적응 레벨링의 전제가 깨지므로, 보존할 값이 아니라 고칠 값이었다.
 *
 * 그래서 `fallback` 인자를 **없앴다.** 값이 하나뿐인데 인자로 받으면 다시 3을 넣을
 * 수 있고, 그 실수는 테스트가 아니라 환자 화면에서 드러난다.
 */
export function normalizeLevel(level: number | undefined): number {
  if (level == null) return COLD_START_LEVEL;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level)));
}


export interface ChoiceSpec {
  /** 정답 포함 선택지 총 개수. */
  total: number;
  /** 오답 중 **같은 의미 범주**에서 뽑을 개수(의미 유인지). */
  sameCat: number;
  /** 오답 중 **첫 음절이 닮은 다른 범주** 낱말에서 뽑을 개수(음운 유인지). */
  phon: number;
}

/**
 * 레벨 → 선택지 구성.
 *
 * ── 오답을 두 갈래로 나눈다 ──────────────────────────────────────
 *
 * 실어증 단어-그림 대응 검사의 유인지는 원래 두 종류다. **의미 유인지**
 * ('사과'에 대한 '바나나')는 의미 체계 손상을 잡고, **음운 유인지**('사과'에
 * 대한 '사자')는 음운 처리 손상을 잡는다. 예전에는 의미 쪽 하나만 썼다.
 *
 * | 레벨 | 총 | 의미 | 음운 | 무관 |
 * |-----|----|-----|-----|-----|
 * |  1  | 2  |  0  |  0  |  1  |
 * |  2  | 3  |  1  |  0  |  1  |
 * |  3  | 4  |  2  |  0  |  1  |
 * |  4  | 4  |  2  |  1  |  0  |  ← 무관 하나가 음운으로 바뀐다
 * |  5  | 5  |  2  |  2  |  0  |
 *
 * 한 단계에 오답 구성이 한 군데만 바뀐다. 총 개수(2·3·4·4·5)는 예전과 같아
 * 화면과 집계는 그대로다 — 바뀐 것은 오답의 **질**이다.
 *
 * ── 왜 의미 오답을 2에서 멈추나 ─────────────────────────────────
 *
 * 예전 매핑은 레벨 4에 같은 범주 3개, 5에 4개를 요구했다. 범주가 3개짜리인
 * 낱말(주방·욕실·연장·가구·악기·가전)은 채울 수가 없어 {@link buildControlledChoices}가
 * **무관 오답으로 조용히 메웠다.** 문항은 쉬워지는데 기록은 레벨 5로 남는다.
 * 실측으로 레벨 4에서 낱말의 20%, 레벨 5에서 33%가 이 구멍에 빠졌다.
 *
 * 가장 작은 범주가 3개(정답 + 동료 2)이므로 **의미 2는 모든 낱말이 채운다.**
 * 난도는 낱말 풀 크기에 안 갇히는 음운 축으로 올린다 — 음운 유인지 2개는
 * 90개 낱말 전부가 채울 수 있다(꽃·빵만 어두 초성이 유일해 느슨한 기준으로
 * 내려간다). **새 낱말도 새 그림도 필요 없다.**
 */
export const LEVEL_CHOICE_SPEC: Record<number, ChoiceSpec> = {
  1: { total: 2, sameCat: 0, phon: 0 }, // 정답 + 무관1
  2: { total: 3, sameCat: 1, phon: 0 }, // 정답 + 의미1 + 무관1
  3: { total: 4, sameCat: 2, phon: 0 }, // 정답 + 의미2 + 무관1 (기존 기본)
  4: { total: 4, sameCat: 2, phon: 1 }, // 정답 + 의미2 + 음운1
  5: { total: 5, sameCat: 2, phon: 2 }, // 정답 + 의미2 + 음운2
};

/** 레벨을 [1..5]로 클램프하고 해당 스펙을 돌려준다(미지정은 콜드스타트=2). */
export function choiceSpecForLevel(level?: number): ChoiceSpec {
  const lv = normalizeLevel(level);
  return LEVEL_CHOICE_SPEC[lv];
}

/**
 * 레벨 → 방해 타일 수.
 *
 * 상용 실어증 치료 도구가 이 과제를 단어 길이 × 방해 글자 **0 / 2 / 4개**로
 * 등급화하는 것을 그대로 따른다. 레벨 1~2에 **방해 0개**(정답 음절 재배열만)를
 * 두는 게 핵심이다 — 예전 구현은 늘 3개라 가장 쉬운 진입 단계가 없었다.
 *
 * 꺾이는 자리는 3과 4다(0·0·2·4·4). 예전엔 2와 4에서 꺾여(0·0·2·2·4) 음절 축과
 * **같은 자리**에서 움직였고, 그래서 5단계가 실제로는 3단계였다. 자세한 표는
 * {@link syllableRangeForLevel} 위에 있다.
 */
export function distractorCountForLevel(level?: number): number {
  // 레벨을 모를 때(스킬 레벨 조회 실패)는 **백엔드 콜드스타트와 같은 값**을 쓴다.
  // 임의의 중간값(3)을 쓰면 환자는 방해 2개짜리를 푸는데 서버는 레벨 2(방해 0개)로
  // 도장을 찍어, 본 난이도와 기록이 어긋난다. 적응 레벨링의 전제가
  // "presented_level로 능력과 제시난이도 교란을 제거한다"이므로 그 전제가 깨진다.
  // 서버가 클라이언트 값을 믿지 않는 건 의도된 설계(eb09bd8)라, 맞춰야 하는 쪽은
  // 프론트의 기본값이다.
  const lv = normalizeLevel(level);
  if (lv <= 2) return 0;
  if (lv === 3) return 2;
  return 4;
}

/**
 * 레벨 → 목표 단어 음절 수 범위.
 *
 * 방해 타일 수만으로는 난이도가 통제되지 않는다. 4음절 단어에 방해 0개는 2음절
 * 단어에 방해 0개와 전혀 다른 과제인데, 예전에는 2~4음절이 섞여 나와 레벨별
 * 정답률이 어휘·순서 부하와 교란됐다("이 환자는 방해 2개에서 잘한다"가 아니라
 * "짧은 단어가 운 좋게 많이 나왔다"를 학습한다).
 *
 * ── 세 축을 엇갈리게 놓는다 ──────────────────────────────────────
 *
 * | 레벨 | 방해 수 | 음절 | 방해 종류 | 타일 |
 * |-----|--------|------|----------|------|
 * |  1  |   0    |  2   |    —     |  2   |
 * |  2  |   0    | 3~4  |    —     | 3~4  |
 * |  3  |   2    | 3~4  |  무작위   | 5~6  |
 * |  4  |   4    | 3~4  |  무작위   | 7~8  |
 * |  5  |   4    | 3~4  | 음운 유사 | 7~8  |
 *
 * **한 단계에 한 축만 움직인다.** 예전에는 방해 수와 음절 범위가 둘 다
 * `lv<=2` / `lv<=4`에서 꺾여, 레벨 1과 2가 같은 문제였고 3과 4도 같았다.
 * 5단계 표시가 실제로는 3단계였다는 뜻이다. 게다가 4→5에서 두 축이 동시에
 * 뛰어 그 자리만 절벽이었다.
 *
 * 4음절 낱말은 풀에 2개뿐이라 `3~4`는 실질 3음절이다. 음절 축이 두 칸(2·3)밖에
 * 없어서 방해 수 세 칸(0·2·4)과 곱해도 **두 축만으로는 5단계를 못 만든다** —
 * 두 축 모두 단조로운 사슬의 최대 길이가 4다. 그래서 코드 주석에 후속 과제로
 * 적혀 있던 **음운 유사 방해자**를 세 번째 축으로 세웠다
 * ({@link usesSimilarDistractors}). 새 낱말도 새 그림도 필요 없다.
 */
export function syllableRangeForLevel(level?: number): { min: number; max: number } {
  const lv = normalizeLevel(level);
  if (lv <= 1) return { min: 2, max: 2 };
  return { min: 3, max: 4 };
}

/**
 * 최고 레벨에서만 방해 타일을 **정답 음절과 닮은 것**으로 고른다.
 *
 * 무작위 방해 타일은 눈으로 걸러진다 — '바다'에 '꽃'이 섞여 있으면 고민이 없다.
 * 초성이나 중성을 공유하는 음절은 그 걸러내기를 막는다. 타일 수는 그대로 4개인데
 * 과제만 어려워지므로, 낱말을 더 넣지 않고도 레벨 4와 5를 가른다.
 */
export function usesSimilarDistractors(level?: number): boolean {
  return normalizeLevel(level) >= 5;
}

/** 공백 제외 음절 수. */
export function syllableCount(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length;
}

/**
 * 레벨 → 통사 유형. **밴드는 셋이다.**
 *
 * | 레벨 | 유형 | 문항 수 |
 * |-----|------|--------|
 * | 1~2 | 능동/수동 | 14 |
 * | 3~4 | 관계절   |  8 |
 * |  5  | 내포절   |  4 |
 *
 * ── 5단계인 척을 하지 않는다 ────────────────────────────────────
 *
 * 자극이 3유형뿐이라 밴드도 셋이다. 5행으로 적으면 5단계인 것처럼 보이지만
 * 실제로는 셋이고, 그 거짓말은 이 저장소에서 이미 두 번 났다(글자 조합의
 * glyph-level-axis, 단어 이해의 word-foil-axis). 여기서는 밴드가 셋이라고
 * 적고, 늘리는 조건은 TODOS의 sent-level-axis에 적어 둔다.
 *
 * ── 누적을 끊었다 ───────────────────────────────────────────────
 *
 * 예전에는 허용 유형이 **누적**이었다(레벨 5 = 능동수동 + 관계절 + 내포절).
 * 그러면 레벨 안에서 난이도가 희석된다 — 레벨 5에서 내포절이 뽑힐 확률이
 * 4/26 = **15%**뿐이라 "레벨 5 정답률"의 85%가 낮은 레벨과 같은 문항이었다.
 * 적응 레벨링은 그 부풀린 값을 보고 승급을 판단한다.
 *
 * 단어 이해는 오답을 코드가 조립하므로 축을 새로 세울 수 있었지만, 문장은
 * 선택지가 JSON 고정 그림 쌍이라(`sentComp_01_correct.png` / `_distractor.png`)
 * 변형할 여지가 없다. 여기서 쓸 수 있는 손잡이는 **어느 유형을 내는가**뿐이다.
 */
export const SENT_TYPE_BY_LEVEL: Record<number, string> = {
  1: 'reversible',
  2: 'reversible',
  3: 'relative-clause',
  4: 'relative-clause',
  5: 'embedded-clause',
};

/** 이 레벨이 내는 통사 유형 하나. (테스트 노출) */
export function sentTypeForLevel(level?: number): string {
  return SENT_TYPE_BY_LEVEL[normalizeLevel(level)];
}

/**
 * 문장이해 **보기 수** — 레벨과 무관하게 4다.
 *
 * 원래는 2지선다였다(정답 + 역할역전 오답). 통사 복잡도만으로 난이도를 준다는
 * 설계였는데, 그 설계에는 값을 치르는 자리가 하나 있었다 — **우연수준 0.5**다.
 *
 * 세션 내 적응(3연속 정답 → 승급)이 들어오면서 그 값이 실제 피해가 됐다. 문장을
 * 전혀 이해하지 못하는 환자가 순전히 찍어서 3연속을 맞출 확률이 2지선다에서
 * `0.5³ = 12.5%`다. 여덟 번에 한 번 승급한다는 뜻이다. 4지선다면 1.6%가 된다.
 *
 * **강등 쪽은 반대로 움직이지 않는다.** 보기를 늘리면 못 맞힐 확률이 오르지만
 * 그건 이해하지 못하는 환자에게만 해당하고, 그 강등은 옳은 판정이다. 이해하는
 * 환자가 틀릴 확률은 보기 수가 아니라 본인 실력이 정한다.
 *
 * **레벨에 따라 2·3·4로 늘리지 않는 이유**가 있다. 그렇게 하면 문장이해에
 * 통사 말고 두 번째 난이도 축이 생긴다 — 이 파일의 다른 규칙들이 축을 하나씩만
 * 두는 것과 어긋나고, "레벨 4 정답률"이 통사 때문인지 보기 수 때문인지 읽을 수
 * 없게 된다. 게다가 화면 격자가 2열이라 3장은 둘째 줄에 한 장이 남는다.
 * 난이도는 계속 자극이 지고(sentTypeForLevel), 보기 수는 우연수준을 낮추는
 * 고정 장치로만 둔다. 4장 배열은 실어증 문장이해 검사의 표준이기도 하다.
 */
export const SENT_CHOICE_TOTAL = 4;

export function sentChoiceTotalForLevel(_level?: number): number {
  return SENT_CHOICE_TOTAL;
}

/** 어절 수 — 공백 기준. 한국어 문장 난이도의 1차 축이다. */
export function wordCount(sentence: string): number {
  return sentence.trim().split(/\s+/).filter((w) => w.length > 0).length;
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
  const lv = normalizeLevel(level);
  if (lv <= 1) return { kind: 'word', min: 1, max: 2 };
  if (lv <= 2) return { kind: 'word', min: 2, max: 3 };
  if (lv <= 3) return { kind: 'mixed', min: 3, max: 4 };
  if (lv <= 4) return { kind: 'sentence', min: 3, max: 5 };
  return { kind: 'sentence', min: 5, max: 7 };
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
  const lv = normalizeLevel(level);
  if (lv <= 1) return { min: 2, max: 2 };
  if (lv <= 2) return { min: 2, max: 3 };
  if (lv <= 3) return { min: 3, max: 4 };
  if (lv <= 4) return { min: 4, max: 5 };
  return { min: 5, max: 7 };
}

/** 길이 범위(양끝 포함). */
export interface LengthRange {
  min: number;
  max: number;
}

/**
 * 영어 문장 밴드 — **단어 수.** 한국어 어절 수 × 1.5를 반올림했다
 * (설계 docs/history/20260913_EnglishSpeechContent_design.md §3-3, 사용자 결정 D1).
 *
 * 같은 뜻이면 영어가 단어는 1.5배, 음절은 오히려 적다 — 음절을 한국어에 맞추면
 * 영어 문장이 내용상 1.5배 무거워지고, 숫자를 그대로 쓰면 짧은 레벨이 전보문이
 * 된다. 경계는 등급 임계값처럼 **관측 항목**이다 — 실사용 정답률이 레벨 순서대로
 * 안 떨어지면 그때 고친다.
 *
 * 낱말(음절) 밴드는 한국어와 같은 개념이라 그대로 쓴다.
 */
const EN_REPEAT_SENTENCE: Readonly<Record<number, LengthRange>> = {
  3: { min: 5, max: 6 },
  4: { min: 5, max: 8 },
  5: { min: 8, max: 11 },
};
const EN_READING: Readonly<Record<number, LengthRange>> = {
  1: { min: 3, max: 3 },
  2: { min: 3, max: 5 },
  3: { min: 5, max: 6 },
  4: { min: 6, max: 8 },
  5: { min: 8, max: 11 },
};

function isEnglish(locale?: string): boolean {
  return locale !== undefined && languageOf(locale) === 'en';
}

/**
 * 따라말하기 밴드를 **로케일별로** — 낱말(음절)과 문장(한국어 어절·영어 단어)을
 * 따로 돌려준다.
 *
 * 한국어는 `repeatSpecForLevel`과 같다(lv3 mixed에서 낱말 음절과 문장 어절이 같은
 * 3~4를 쓴다). 영어는 lv3에서 둘이 갈린다 — 낱말 3~4음절, 문장 5~6단어. 그래서
 * 범위 하나(`min`/`max`)로는 표현이 안 돼 둘로 나눴다. 로케일을 안 주면 한국어다.
 */
export function repeatBandsForLevel(
  level?: number,
  locale?: string,
): {
  kind: 'word' | 'sentence' | 'mixed';
  word: LengthRange | null;
  sentence: LengthRange | null;
} {
  const spec = repeatSpecForLevel(level);
  const range = { min: spec.min, max: spec.max };
  const word = spec.kind === 'sentence' ? null : range;
  let sentence = spec.kind === 'word' ? null : range;
  if (sentence !== null && isEnglish(locale)) {
    sentence = EN_REPEAT_SENTENCE[normalizeLevel(level)] ?? sentence;
  }
  return { kind: spec.kind, word, sentence };
}

/** 읽기 밴드를 로케일별로. 로케일을 안 주면 한국어(`readingRangeForLevel`)다. */
export function readingBandForLevel(level?: number, locale?: string): LengthRange {
  return isEnglish(locale)
    ? EN_READING[normalizeLevel(level)]
    : readingRangeForLevel(level);
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


export interface DdkSpec {
  kind: DdkKind;
  targetCount: number;
}


export const LEVEL_DDK_SPEC: Record<number, DdkSpec> = {
  1: { kind: 'amr', targetCount: 6 },
  2: { kind: 'amr', targetCount: 10 },
  3: { kind: 'amr', targetCount: 14 },
  4: { kind: 'smr2', targetCount: 5 },
  5: { kind: 'smr3', targetCount: 8 },
};


export function ddkSpecForLevel(level?: number): DdkSpec {
  return LEVEL_DDK_SPEC[normalizeLevel(level)];
}
