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
