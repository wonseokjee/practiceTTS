// 기능 플래그 — 코드는 남기되 사용자에게 노출할지만 제어한다.
//
// 삭제 대신 플래그를 쓰는 이유: 되돌리기가 환경변수 한 줄이고, 지금 동작하는
// 상태와 테스트가 그대로 보존된다. 나중에 이어서 고도화할 때 복원 비용이 없다.

/** Vite 환경변수를 불리언으로 읽는다. 'true'만 참으로 본다(미설정=거짓). */
function readFlag(value: unknown): boolean {
  return value === 'true' || value === true;
}

/**
 * 환자 대화(회상 훈련) 모드를 노출할지.
 *
 * **기본 꺼짐.** 대화 모드는 자유 발화를 받아야 하는데 지금은 브라우저 내장
 * 인식(WebSpeechSttService)을 쓴다. 브라우저 STT는 병리 발화(실어증·치매)를
 * 잘 못 알아들어서, 환자가 말해도 인식이 안 되는 좌절 경험이 되기 쉽다.
 * 자유 발화 STT를 갖추기 전까지는 감춰 둔다.
 *
 * 내부 테스트로 실사용 감을 잡으려면 `frontend/.env`에
 * `VITE_ENABLE_CONVERSATION=true`를 넣고 프론트를 재시작한다.
 *
 * 켜기 전에 확인할 것: 대화가 열리려면 보호자가 기억마다 목표 단어를 등록하고
 * 시나리오를 생성해야 한다(목록 카드가 다음 단계를 안내한다).
 */
export const isConversationModeEnabled = (): boolean =>
  readFlag(import.meta.env.VITE_ENABLE_CONVERSATION);

/**
 * 이름대기 **이웃 비교 채점**을 쓸지.
 *
 * **기본 꺼짐.** 켜면 한국어(ko-KR) 이름대기에서 같은 녹음을 목표뿐 아니라 소리가 가까운
 * 다른 단어(이웃)와 후보 없이 인식한 결과로도 채점해, 가까운 다른 단어를 말했을 때 정답으로
 * 치지 않는다(설계: docs/history/20260926_NeighborScoring_design.md).
 *
 * 켜면 **채점 규칙이 바뀐다** — 가까운 다른 단어를 말한 시도가 정답에서 모호(재시도)로 옮겨가
 * 전환 시점에 정답률이 내려간다. 환자가 나빠진 게 아니라 자가 바뀐 것이라, 기록에
 * `scorer_version`이 남고 보호자 화면이 전환을 표시한다. 켜기 전에 확인할 것: 스테이징에서
 * 모호율(1차 ≤ 15%)과 보호자 정정률을 본다(계획 PR 6).
 *
 * 끄면 즉시 이전 채점(`azure-pa-v1`)으로 돌아간다. 이미 기록된 행은 버전으로 갈라 볼 수 있어
 * 고칠 데이터가 없다.
 */
export const isNeighborScoringEnabled = (): boolean =>
  readFlag(import.meta.env.VITE_ENABLE_NEIGHBOR_SCORING);
