// 한국어 조사 선택
//
// 화면 문구를 `${낱말}예요`처럼 이어붙이면 받침 있는 낱말에서 곧바로 깨진다.
// "칫솔예요", "장면예요"는 한국어가 아니다. 어르신에게 읽히는 문장이라
// 어색함이 바로 신뢰를 깎는다.

const HANGUL_FIRST = 0xac00; // '가'
const HANGUL_LAST = 0xd7a3; // '힣'
const JONGSEONG_COUNT = 28; // 받침 없음(0) + 받침 27종

/**
 * 낱말의 마지막 글자에 받침이 있는가.
 *
 * 한글 음절이 아니면(빈 문자열·숫자·영문·기호) `null`을 준다 — 모른다는 뜻이지
 * 없다는 뜻이 아니다.
 */
export function hasFinalConsonant(word: string): boolean | null {
  const last = word.trimEnd().at(-1);
  if (last === undefined) return null;
  const code = last.codePointAt(0);
  if (code === undefined || code < HANGUL_FIRST || code > HANGUL_LAST) {
    return null;
  }
  return (code - HANGUL_FIRST) % JONGSEONG_COUNT !== 0;
}

/**
 * 서술격 조사 — "사과**예요**" / "칫솔**이에요**".
 *
 * 낱말과 따로 돌려주는 이유는 화면이 낱말을 따옴표로 감싸기 때문이다.
 * `'칫솔'` 뒤에 붙여야 하는데, 받침 판정은 따옴표가 아니라 낱말을 봐야 한다.
 *
 * 한글이 아닐 때는 '예요'로 둔다. 확신이 없을 때 둘 중 덜 튀는 쪽이다.
 */
export function copulaSuffix(word: string): '이에요' | '예요' {
  return hasFinalConsonant(word) === true ? '이에요' : '예요';
}

// ─── 음운 유사도 ────────────────────────────────────────────────────

const JUNGSEONG_COUNT = 21; // 중성 21종 (초성 수는 나눗셈에 안 쓰여 상수가 없다)

/** 한글 음절 하나를 초성·중성 인덱스로 쪼갠다. 한글 음절이 아니면 null. */
function onsetAndNucleus(ch: string): { onset: number; nucleus: number } | null {
  const code = ch.codePointAt(0);
  if (code === undefined || code < HANGUL_FIRST || code > HANGUL_LAST) {
    return null;
  }
  const offset = code - HANGUL_FIRST;
  return {
    onset: Math.floor(offset / (JUNGSEONG_COUNT * JONGSEONG_COUNT)),
    nucleus: Math.floor(offset / JONGSEONG_COUNT) % JUNGSEONG_COUNT,
  };
}

/**
 * 두 음절이 초성 **또는** 중성을 공유하는가 — 헷갈릴 만큼 닮았는가.
 *
 * 글자 조합 최고 레벨의 방해 타일을 고르는 데 쓴다. 무작위 방해 타일은 정답
 * 음절과 아무 관계가 없어 눈으로 걸러진다("바다"에 '꽃'이 섞여 있으면 고민이
 * 없다). 초성이나 중성을 공유하는 음절은 그 걸러내기를 못 하게 한다 — 실어증
 * 치료에서 음운 유사 방해자가 난도를 올리는 자리가 여기다.
 *
 * 종성은 보지 않는다. 받침까지 맞추라고 하면 40자 풀에서 후보가 거의 안 남고,
 * 부족분을 무작위로 채우면 레벨이 도로 내려간다.
 *
 * 한글이 아닌 글자는 **닮지 않았다**로 본다 — 모를 때 난도를 올리지 않는다.
 */
export function sharesOnsetOrNucleus(a: string, b: string): boolean {
  const x = onsetAndNucleus(a);
  const y = onsetAndNucleus(b);
  if (x === null || y === null) return false;
  return x.onset === y.onset || x.nucleus === y.nucleus;
}

/**
 * 두 **낱말**의 첫 음절 초성이 같은가 — 음운 유인지의 표준 기준.
 *
 * 실어증 단어-그림 대응 검사에서 유인지는 두 갈래다. 의미 유인지('사과'에 대한
 * '바나나')는 의미 체계 손상을 잡고, **음운 유인지**('사과'에 대한 '사자')는
 * 음운 처리 손상을 잡는다. 둘은 다른 것을 재므로 한 문항에서 섞지 않는다.
 *
 * 어두 음소 겹침을 기준으로 삼는 이유는 한국어 낱말 인지가 초성에 크게 기대기
 * 때문이다. {@link sharesOnsetOrNucleus}처럼 중성까지 허용하면 '가위'가 '사과'의
 * 음운 유인지가 되는데(ㅏ만 공유), 그건 유인지로서 너무 약하다.
 */
export function sharesInitialConsonant(a: string, b: string): boolean {
  const x = onsetAndNucleus(a.trimStart().charAt(0));
  const y = onsetAndNucleus(b.trimStart().charAt(0));
  if (x === null || y === null) return false;
  return x.onset === y.onset;
}
