/**
 * 생성 경로별 하루 상한 — 환자(가구) 한 명, 환자 로컬 하루 기준.
 *
 * **정상 사용을 한참 넘는 값으로 잡는다**(실행 계획 §9 예외 둘째). 목적은 무한
 * 호출로 LLM 비용이 새는 것을 막는 것이지 사용량을 아끼게 하는 것이 아니다.
 * 상한에 닿는 사람이 실사용자라면 값이 틀린 것이다 — 올린다.
 *
 * 카운터는 **호출 전에** 올라가므로 실패한 AI 호출·검증에 걸린 요청도 센다
 * (알려진 한계). 그래서 더 넉넉히 둔다.
 *
 *   memory       기억 등록(자동 퀴즈 생성이 딸려 간다)   하루 몇 건이 보통
 *   quiz         수동 퀴즈 생성·재생성                    기억당 몇 번
 *   scenario     대화 시나리오 생성                        기억당 한두 번
 *   conversation 대화 훈련 메시지 한 턴                    세션당 수십 턴
 */
export const DAILY_GENERATION_CAPS = {
  memory: 30,
  quiz: 50,
  scenario: 50,
  conversation: 500,
} as const;

export type GenerationKind = keyof typeof DAILY_GENERATION_CAPS;

/** M30의 CHECK와 같은 목록. */
export const GENERATION_KINDS = Object.keys(
  DAILY_GENERATION_CAPS,
) as GenerationKind[];
