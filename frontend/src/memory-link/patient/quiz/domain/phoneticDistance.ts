// 한국어 음소 유사도 기반 음절 거리 — 구음장애·노인 발화의 조음 유사 혼동을 관대하게 본다.
//
// 배경: 표준 편집거리는 음절(글자) 단위 cost=1 균일이라, 구음장애에서 가장 흔한
//       조음 유사 음소 혼동(ㅂ↔ㅍ, ㄷ↔ㅌ, 종성 탈락 등)을 반영하지 못한다.
//       여기서는 음절을 초성·중성·종성으로 분해하고, 조음 위치가 같은 음소끼리는
//       부분 비용을 주는 가중 거리를 계산한다.
//
// 원칙(진단 변별력 보존): '조음 위치가 같은' 혼동만 감면한다. 조음 위치가 다른
//       오류는 그대로 오류로 둔다(너무 관대하면 QAB 점수 변별력이 떨어짐).

/** 초성 19자 (유니코드 조합 순서) */
const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

/** 중성 21자 */
const JUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
] as const;

/** 종성 28자 (인덱스 0 = 종성 없음) */
const JONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** 분해된 한글 음절: 초성/중성/종성 자모. */
interface Jamo {
  cho: string;
  jung: string;
  jong: string;
}

/** 완성형 한글 1글자를 자모로 분해. 한글이 아니면 null. */
export function decomposeHangul(ch: string): Jamo | null {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const offset = code - HANGUL_BASE;
  return {
    cho: CHO[Math.floor(offset / 588)],
    jung: JUNG[Math.floor((offset % 588) / 28)],
    jong: JONG[offset % 28],
  };
}

/**
 * 조음 위치가 같은 음소 그룹 — 그룹 내 치환은 부분 비용(SAME_GROUP_COST).
 * 구음장애에서 흔한 혼동(평음/경음/격음, 파찰음, 치조 마찰, 비음/유음)을 반영한다.
 */
const CONSONANT_GROUPS: readonly (readonly string[])[] = [
  ['ㄱ', 'ㄲ', 'ㅋ'], // 연구개 파열음
  ['ㄷ', 'ㄸ', 'ㅌ'], // 치조 파열음
  ['ㅂ', 'ㅃ', 'ㅍ'], // 양순 파열음
  ['ㅈ', 'ㅉ', 'ㅊ'], // 파찰음
  ['ㅅ', 'ㅆ'], // 치조 마찰음
  ['ㄴ', 'ㄹ', 'ㅁ', 'ㅇ'], // 비음·유음
];

/** 혀 높이·위치가 가까운 모음 그룹. */
const VOWEL_GROUPS: readonly (readonly string[])[] = [
  ['ㅏ', 'ㅓ'],
  ['ㅗ', 'ㅜ'],
  ['ㅐ', 'ㅔ', 'ㅚ', 'ㅟ', 'ㅙ', 'ㅞ'],
  ['ㅡ', 'ㅣ', 'ㅢ'],
  ['ㅑ', 'ㅕ'],
  ['ㅛ', 'ㅠ'],
];

/** 조음 유사 음소 치환 비용(완전 다름=1). */
const SAME_GROUP_COST = 0.3;
/** 종성 탈락/삽입 비용(노인·구음장애에 흔해 관대). */
const JONG_DROP_COST = 0.4;

/** 자모 그룹 표에서 두 음소의 치환 비용을 구한다. */
function groupedCost(
  a: string,
  b: string,
  groups: readonly (readonly string[])[],
): number {
  if (a === b) return 0;
  for (const g of groups) {
    if (g.includes(a) && g.includes(b)) return SAME_GROUP_COST;
  }
  return 1;
}

/** 종성 치환 비용 — 한쪽만 종성이 있으면 '탈락'으로 관대하게 본다. */
function jongCost(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '' || b === '') return JONG_DROP_COST;
  return groupedCost(a, b, CONSONANT_GROUPS);
}

// 음절 비용 내 자모 가중치(초성·중성이 지각적으로 더 중요, 종성은 관대).
const W_CHO = 0.4;
const W_JUNG = 0.4;
const W_JONG = 0.2;

/**
 * 두 글자(음절)의 음소 유사 거리 — 0(동일)~1(완전 다름).
 * 한글이면 자모별 가중 비용, 한글이 아니면 단순 일치 비교(0/1).
 */
export function syllablePhoneticCost(a: string, b: string): number {
  if (a === b) return 0;
  const ja = decomposeHangul(a);
  const jb = decomposeHangul(b);
  // 한쪽이라도 한글이 아니면 자모 비교 불가 → 단순 불일치.
  if (ja === null || jb === null) return 1;
  return (
    groupedCost(ja.cho, jb.cho, CONSONANT_GROUPS) * W_CHO +
    groupedCost(ja.jung, jb.jung, VOWEL_GROUPS) * W_JUNG +
    jongCost(ja.jong, jb.jong) * W_JONG
  );
}

/**
 * 음절 배열 간 가중 편집거리(치환 비용 = 음소 유사 거리).
 * 삽입/삭제 비용은 1로 둔다.
 */
export function phoneticEditDistance(
  a: readonly string[],
  b: readonly string[],
): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const sub = prev[j - 1] + syllablePhoneticCost(a[i - 1], b[j - 1]);
      curr[j] = Math.min(
        prev[j] + 1, // 삭제
        curr[j - 1] + 1, // 삽입
        sub, // 치환(음소 유사 비용)
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
