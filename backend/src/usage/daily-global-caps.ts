/**
 * 서비스 전체 합계의 하루 상한 — 가구별 상한(`DAILY_GENERATION_CAPS`)과는 별개다.
 *
 * **왜 또 필요한가.** 가구별 상한은 계정 하나가 새는 것만 막는다. 계정을 여러 개 만들거나
 * 탈취된 계정이 여럿이면 합계가 무한정 커진다. ai-service의 회로차단기(TTS 600/분,
 * STT·발음 240/분)는 **분당·인메모리**라 재시작마다 0이 되고, 하루로 환산하면 STT만
 * 34만 건까지 통과한다(Azure 유료). 이 상한은 그 위에 얹는 **하루 총량 천장**이다 —
 * 해킹·폭주로 청구서가 무한정 커지는 것을 막는 최후 방어선.
 *
 * **정상 사용을 한참 넘는 값으로 잡는다.** 초기 코호트(수십 가구)의 실사용은 이 값의
 * 몇 분의 일이다. 첫 배포 후 며칠간 `daily_global_usage`의 실사용량을 보고 조정한다.
 * 실사용자가 상한에 닿는다면 값이 틀린 것이다 — 올린다(코드 수정 + 배포).
 *
 * 하루는 **UTC 날짜**다(가구별 상한처럼 환자 로컬 자정이 아니다) — 서비스 전체 비용
 * 창이라 한 시계로 자른다.
 *
 * TTS는 캐시 적중도 센다(백엔드는 적중/미스를 모른다). 그래서 값이 크다.
 */
export const GLOBAL_DAILY_CAPS = {
  // Gemini(LLM) — 생성 경로
  memory: 300,
  quiz: 500,
  scenario: 500,
  conversation: 5000,
  // Azure Speech — ai-service 프록시 경로
  stt: 3000,
  pronunciation: 3000,
  tts: 30000,
} as const;

export type GlobalCapKind = keyof typeof GLOBAL_DAILY_CAPS;

/** M31의 CHECK와 같은 목록. */
export const GLOBAL_CAP_KINDS = Object.keys(
  GLOBAL_DAILY_CAPS,
) as GlobalCapKind[];
