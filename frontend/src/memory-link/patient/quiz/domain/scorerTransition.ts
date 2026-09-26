// 채점기가 바뀐 지점 — 보호자 화면이 추이를 잘못 읽게 하지 않으려는 규칙.
//
// 이웃 비교 채점을 켜면 정답 처리 규칙이 바뀐다: 가까운 다른 단어를 말한 시도가 정답에서 모호(재시도)로
// 옮겨간다. 그러면 전환 시점에 정답률이 내려가는데 그건 환자가 나빠진 게 아니라 **자가 바뀐 것**이다
// (음향 채점 계획 7절). 보호자는 그 꺾임을 악화로 읽을 수 있어서, 두 가지를 한다.
//   1) 채점 방식이 바뀐 날짜를 알린다.
//   2) 전환을 사이에 둔 두 주의 ▲▼ 변화는 보여주지 않는다 — **채점기를 넘어 기울기를 잇지 않는다.**

import type { QabSubtestSummary, QabWeeklyPoint } from './QabResult.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 이 검사의 채점 방식이 바뀐 시각(ISO). 바뀐 적이 없거나 서버가 모르면 null.
 *
 * 버전이 둘 이상이고 전환 시각이 있을 때만이다. 버전이 하나뿐(처음부터 새 채점기, 또는 옛 채점기만)이면
 * 바뀐 것이 없다.
 */
export function scorerChangedAt(
  summary: Pick<QabSubtestSummary, 'scorerVersions' | 'scorerChangedAt'>,
): string | null {
  if (!summary.scorerChangedAt) return null;
  return (summary.scorerVersions?.length ?? 0) > 1 ? summary.scorerChangedAt : null;
}

/**
 * 직전 주 대비 변화(▲▼)를 보여도 되는가.
 *
 * 비교하는 **두 주가 모두 전환 뒤**일 때만 참이다. 전환이 그 두 주 안이거나 그 사이면 서로 다른 채점기로
 * 잰 값을 빼는 것이라 거짓이다. 주 경계는 사용자 시간대로, 전환 시각은 UTC라 최대 하루 어긋날 수 있어
 * 하루 여유를 둔다 — **애매하면 숨기는 쪽**이다(보이지 않는 것보다 잘못 보이는 것이 해롭다).
 */
export function isDeltaComparable(
  points: readonly QabWeeklyPoint[],
  changedAt: string | null,
): boolean {
  if (changedAt === null || points.length < 2) return true;
  const previousWeek = points[points.length - 2];
  const previousWeekStart = Date.parse(`${previousWeek.weekStart}T00:00:00Z`);
  return Date.parse(changedAt) < previousWeekStart - DAY_MS;
}
