/**
 * 이벤트 이름 → 그 이벤트가 허용하는 payload 키 목록.
 *
 * `ValidationPipe`(main.ts:22-24)의 `whitelist: true`·`forbidNonWhitelisted: true`는
 * DTO의 **최상위** 필드만 본다. `CreateEventDto.payload`는 `@IsObject()`로만
 * 검사돼 안쪽 키는 통과한다 — 이 레지스트리가 그 구멍을 막는다(계획 §13-4의 3-1).
 *
 * 이 저장소의 다른 곳(`ValidationPipe`)이 미등록 필드를 **거부**(400)로 다루므로,
 * 여기서도 같은 규칙을 쓴다 — 조용히 지우면 클라이언트 버그를 계속 못 본 채로
 * 통과시킨다.
 *
 * 새 이벤트를 추가하려면 여기에 한 줄만 늘리면 된다 — 마이그레이션이 필요 없다
 * (`event.entity.ts`의 `gstack-shortcut(dec-5e12e08e)` 참고).
 */
export const EVENT_REGISTRY = {
  /** 보호자가 주간 추이 화면(qab-trend)을 열었다. */
  qab_trend_viewed: ['screen'],
  /** 보호자가 검사별 요약 화면(qab-summary)을 열었다. */
  qab_summary_viewed: ['screen'],
  /** 보호자가 세션 완료율 화면(session-stats)을 열었다. */
  session_stats_viewed: ['screen'],
} as const satisfies Record<string, readonly string[]>;

export type EventName = keyof typeof EVENT_REGISTRY;

export function isKnownEventName(name: string): name is EventName {
  return name in EVENT_REGISTRY;
}

/** payload에서 그 이벤트가 허용하지 않는 키만 골라 돌려준다(없으면 빈 배열). */
export function unknownPayloadKeys(
  eventName: EventName,
  payload: Record<string, unknown> | undefined,
): string[] {
  if (!payload) return [];
  const allowed = new Set<string>(EVENT_REGISTRY[eventName]);
  return Object.keys(payload).filter((key) => !allowed.has(key));
}
