// 이름대기 단서 위계 — 무엇을 얼마나 알려줄 것인가.
//
// 이름대기는 7개 하위검사 중 유일하게 난이도 축이 없었다. 길이 축은 못 세운다
// (음절 분포 1:13 / 2:49 / 3:27 / **4:2** — 4음절 밴드에 자극이 둘뿐이다).
// 임상 표준 축은 **단서 위계**고, 자극을 하나도 안 만들어도 된다.
//
// 재는 값이 "맞혔나"에서 **"얼마나 도와야 맞혔나"** 로 바뀐다. 그래서 단서를
// 매번 받는 환자도 기록이 남는다 — 예전에는 `넘어가기`가 `assisted`로만 남고
// 모든 집계에서 빠져서, 도움이 필요한 환자일수록 데이터가 0이었다.
//
// ## 번호를 띄워 둔 이유
//
//   0  무단서
//   1  의미 단서      "동물이에요"
//   2  (문장 완성)    ← 아직 없다. 자극 91개에 문구를 손으로 써야 한다.
//   3  음소 단서      "사…" / 한 글자면 "첫소리는 시옷이에요"
//   4  통과           정답을 알려준다
//
// 2번을 건너뛰면서 3·4를 2·3으로 당기지 않았다. `cue_level`은 DB에 남는 값이라,
// 나중에 문장 완성이 들어올 때 번호를 밀면 **그 전에 쌓인 기록의 뜻이 바뀐다**.
// 빈 칸으로 두는 편이 싸다.
//
// ## 모델 제공(따라 읽히기)이 없는 이유
//
// TODOS의 원안은 1단계가 "모델 제공"이었다. 넣지 않았다 — 정답을 들려준 뒤의
// 발화는 이름대기가 아니라 **따라말하기**고, 그 검사(`repeat`)는 로테이션에
// 따로 있다. 같은 것을 두 검사에서 재면 보호자 화면의 두 줄이 같은 값을 다르게
// 부른다. 정답을 알려주는 자리는 4단계(통과)가 이미 맡고 있다.

/** 단서를 하나도 안 받은 상태. */
export const CUE_NONE = 0;
/** 의미 단서 — 무엇의 무리인지. */
export const CUE_SEMANTIC = 1;
/** 음소 단서 — 첫 소리. */
export const CUE_PHONEMIC = 3;
/** 통과 — 정답을 알려주고 넘어간다. */
export const CUE_GIVEN = 4;

/** 화면이 오르내리는 사다리. 2번(문장 완성)은 아직 없다. */
export const CUE_LADDER: readonly number[] = [
  CUE_NONE,
  CUE_SEMANTIC,
  CUE_PHONEMIC,
  CUE_GIVEN,
];

export interface Cue {
  level: number;
  /** 화면에 적는 말. */
  text: string;
  /**
   * 소리로 들려줄 말. 화면 글과 다를 수 있다 — 자모는 이름으로 읽어야 한다
   * ("ㅅ"이 아니라 "시옷"). 읽히지 않는 단서는 `null`.
   */
  speak: string | null;
}

/**
 * 의미 범주 → 단서 문장.
 *
 * 범주마다 자연스러운 말이 다르다. "동물에서 쓰는 물건이에요"는 말이 안 된다.
 * `WORD_CATEGORY`의 15개를 빠짐없이 덮는다(테스트가 지킨다).
 */
const SEMANTIC_CUE: Record<string, string> = {
  animal: '동물이에요.',
  appliance: '집에서 쓰는 전기 제품이에요.',
  bathroom: '욕실에서 쓰는 물건이에요.',
  body: '몸의 한 부분이에요.',
  clothing: '몸에 입거나 걸치는 거예요.',
  food: '먹는 거예요.',
  furniture: '집에 두고 쓰는 가구예요.',
  instrument: '소리를 내는 악기예요.',
  kitchen: '부엌에서 쓰는 물건이에요.',
  person: '사람이에요.',
  place: '어딘가 가는 곳이에요.',
  plant: '자라나는 식물이에요.',
  stationery: '글 쓸 때 쓰는 물건이에요.',
  tool: '무언가 고칠 때 쓰는 연장이에요.',
  vehicle: '타고 다니는 거예요.',
};

const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

/** 자모의 **이름**. TTS는 "ㅅ"을 못 읽으므로 "시옷"으로 바꿔 들려준다. */
const JAMO_NAME: Record<string, string> = {
  ㄱ: '기역', ㄲ: '쌍기역', ㄴ: '니은', ㄷ: '디귿', ㄸ: '쌍디귿',
  ㄹ: '리을', ㅁ: '미음', ㅂ: '비읍', ㅃ: '쌍비읍', ㅅ: '시옷',
  ㅆ: '쌍시옷', ㅇ: '이응', ㅈ: '지읒', ㅉ: '쌍지읒', ㅊ: '치읓',
  ㅋ: '키읔', ㅌ: '티읕', ㅍ: '피읖', ㅎ: '히읗',
};

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JUNG_JONG = 21 * 28;

/** 한글 음절의 첫 자음. 한글이 아니면 `null`. */
export function choseongOf(syllable: string): string | null {
  const code = syllable.codePointAt(0);
  if (code === undefined || code < HANGUL_BASE || code > HANGUL_LAST) {
    return null;
  }
  return CHOSEONG[Math.floor((code - HANGUL_BASE) / JUNG_JONG)];
}

/**
 * 이 자극에서 그 단계를 줄 수 있는가.
 *
 * 의미 단서는 **범주가 있는 자극만** 받는다. 91개 중 9개가 `null`이다
 * (가방·풍선·바구니·양초·우체통·돌·우산·열쇠·시계). 없는 단서를 빈 화면으로
 * 보여주느니 그 칸을 건너뛴다.
 */
export function hasCue(
  word: string,
  category: string | null,
  level: number,
): boolean {
  if (level === CUE_NONE || level === CUE_GIVEN) return true;
  if (level === CUE_SEMANTIC) {
    return category !== null && category in SEMANTIC_CUE;
  }
  if (level === CUE_PHONEMIC) return choseongOf(word[0] ?? '') !== null;
  return false;
}

/**
 * 그 단계에서 보여줄 단서. 줄 수 없으면 `null`.
 *
 * **한 글자 낱말은 첫 음절이 아니라 초성을 준다.** 책·꽃·칼·돌·배·곰·집·손·
 * 발·눈·귀·코·입 — 91개 중 13개다. 이들에게 "첫 음절"을 주면 정답을 통째로 준
 * 것이라 3단계와 4단계(통과)가 같아져 사다리가 꼭대기에서 무너진다. 임상의
 * 음소 단서(phonemic cue)가 원래 초성이라 오히려 표준에 가깝다.
 */
export function cueForLevel(
  word: string,
  category: string | null,
  level: number,
): Cue | null {
  if (!hasCue(word, category, level)) return null;

  if (level === CUE_SEMANTIC && category !== null) {
    const text = SEMANTIC_CUE[category];
    return { level, text, speak: text };
  }

  if (level === CUE_PHONEMIC) {
    const first = word[0] ?? '';
    if (word.length === 1) {
      const jamo = choseongOf(first);
      const name = jamo === null ? null : JAMO_NAME[jamo];
      return {
        level,
        text: `첫소리는 ${jamo ?? first}`,
        speak: name === null ? null : `첫소리는 ${name}이에요.`,
      };
    }
    return { level, text: `${first}…`, speak: first };
  }

  if (level === CUE_GIVEN) {
    return { level, text: word, speak: word };
  }

  return null;
}

/**
 * 힌트를 한 번 더 눌렀을 때 갈 단계. 줄 수 없는 칸은 건너뛴다.
 *
 * 사다리 끝(통과)에서는 더 오르지 않는다 — 통과는 힌트가 아니라 문항을
 * 끝내는 동작이라 화면이 따로 다룬다.
 */
export function nextCueLevel(
  word: string,
  category: string | null,
  current: number,
): number {
  const rest = CUE_LADDER.filter((l) => l > current);
  for (const level of rest) {
    if (hasCue(word, category, level)) return level;
  }
  return CUE_GIVEN;
}
