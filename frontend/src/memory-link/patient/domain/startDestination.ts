// '오늘 연습 시작하기'를 누르면 어디로 가나 (순수 규칙).
//
// 예전에는 무조건 퀴즈 목록 화면으로 보냈다. 버튼에는 "시작하기"라고 적혀 있는데
// 고르는 화면이 나오니 라벨이 어긋났고, 실제로 그 목록엔 카드가 하나뿐인 경우가
// 많았다 — 한 번 더 누르게 만드는 것 말고 하는 일이 없었다.
//
// 훅 안의 조건문으로 두지 않고 여기로 뺀 이유는 이게 glue가 아니라 **규칙**이기
// 때문이다. "몇 개일 때 어디로 가는가"는 화면을 띄우지 않고 검증할 수 있어야 한다.

/** 시작 버튼이 향할 곳. */
export type StartDestination =
  | { kind: 'quiz'; quizSetId: string }
  | { kind: 'list' };

/**
 * @param readySets 홈에서 미리 받아 둔 풀 수 있는 퀴즈.
 *   `null`이면 **아직 모른다**(조회 전이거나 실패). 그때는 목록으로 보낸다 —
 *   목록 화면이 자체적으로 다시 조회하고 오류도 거기서 보여준다. 홈에서 환자를
 *   멈춰 세우거나 빈 화면을 띄우지 않는 것이 요점이다.
 */
export function startDestination(
  readySets: readonly { quizSetId: string }[] | null,
): StartDestination {
  if (readySets !== null && readySets.length === 1) {
    return { kind: 'quiz', quizSetId: readySets[0].quizSetId };
  }
  return { kind: 'list' };
}
