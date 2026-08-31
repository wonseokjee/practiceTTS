// Fisher-Yates 셔플 — 프로젝트 전체에서 이것 하나만 쓴다.
//
// 예전에는 같은 구현이 **일곱 곳**에 복사돼 있었다(문항 뱅크 2, 연습 2, 세션 훅 1,
// 검사 유스케이스 2). 값이 같으니 문제없어 보이지만 두 가지가 걸렸다.
//
// **1. `rng` 주입이 한 곳에만 있었다.** `QabItemBank`의 것만 난수원을 받아 테스트가
// 결정적으로 돌았고, 나머지 여섯은 `Math.random`에 고정이라 그 코드 경로를 확정적
// 으로 검증할 방법이 없었다. 무작위에 의존하는 테스트는 통과할 때도 무엇을 증명하는지
// 알 수 없다 — 실제로 이번에 `tileRange`가 3회 중 1회 실패했다(E17).
//
// **2. 고칠 곳이 일곱 군데가 된다.** 편향 없는 셔플은 `i`를 내림차순으로 돌며
// `j <= i`에서 뽑아야 한다. 위쪽에서 뽑거나 `j < i`로 쓰면 분포가 치우치는데,
// 복사본이 흩어져 있으면 한둘만 고치고 나머지를 놓친다.

/**
 * 원본을 바꾸지 않고 섞은 새 배열을 돌려준다.
 *
 * @param rng 0 이상 1 미만을 돌려주는 난수원. 테스트에서 고정해 결정적으로 만든다.
 */
export function shuffle<T>(
  items: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
