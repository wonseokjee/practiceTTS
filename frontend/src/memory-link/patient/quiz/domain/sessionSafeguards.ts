// 세션 안전장치 (순수 로직)
//
// 결손 표적 적응이 "약점만 반복해 성공감을 무너뜨리는 실패 나선"이 되지 않도록
// 하는 가드(plan-eng-review 확정, Codex 지적 흡수). 고령 인지장애 솔로 사용자에겐
// 성공 경험이 순응도의 핵심이다.
//   - success-ending: 세션의 마지막을 성공 확률 높은 항목으로 마무리
//   - 피로 탈출: 연속 오답이 임계치에 닿으면 그날 세션을 조기 종료
//
// 결손 비율 상한(≤40%) 배분은 세션 조립 재구조가 필요해 후속에서 다룬다.

/** 연속 오답이 이 수에 닿으면 그날 세션을 조기 종료한다. */
export const FATIGUE_EXIT_THRESHOLD = 3;

/**
 * 연속 오답 수로 피로 탈출 여부를 판정한다(순수).
 * @param consecutiveWrong 지금까지 연속 오답 수(정답이 나오면 0으로 리셋)
 */
export function shouldFatigueExit(
  consecutiveWrong: number,
  threshold: number = FATIGUE_EXIT_THRESHOLD,
): boolean {
  return consecutiveWrong >= threshold;
}

/**
 * success-ending: successRank가 가장 큰(성공 확률 높은) 항목 1개를 맨 뒤로 보내고,
 * 나머지는 원래 순서를 보존한다. 세션을 성취감으로 마무리해 다음 복귀를 돕는다.
 *
 * 동점이면 앞쪽 항목을 마지막으로 쓴다(안정 정렬). 항목이 0~1개면 그대로 반환.
 */
export function moveEasiestLast<T>(
  items: readonly T[],
  successRank: (item: T) => number,
): T[] {
  if (items.length <= 1) return [...items];
  let bestIdx = 0;
  let bestRank = successRank(items[0]);
  for (let i = 1; i < items.length; i += 1) {
    const r = successRank(items[i]);
    if (r > bestRank) {
      bestRank = r;
      bestIdx = i;
    }
  }
  const rest = items.filter((_, i) => i !== bestIdx);
  return [...rest, items[bestIdx]];
}
