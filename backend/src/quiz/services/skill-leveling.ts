/**
 * 스킬별 숙달 레벨 — 값과 경계.
 *
 * 환자별×스킬(=QAB 서브테스트)별 1~5단계 난이도다.
 *
 * **판정은 여기 없다.** 예전에는 이 파일이 "현재 레벨에서 제시된 최근 10시행의
 * 정확도"로 레벨을 재계산했다. 실측 판정 지연이 검사당 5~11세션이었고, 재활
 * 환자의 일간 변동(피로·시간대·투약)은 그보다 훨씬 빨라서, 학습되는 것이 능력이
 * 아니라 최근 며칠의 컨디션 노이즈였다(D7).
 *
 * 이제 판정은 **세션 안에서 문항 단위**로 일어난다(프론트
 * `domain/sessionAdaptation.ts`). 서버는 세션이 끝날 때 그 결과를 받아 저장하되,
 * 저장된 레벨에서 ±1을 벗어나면 접는다 — 적응 규칙이 세션당 한 칸이므로 정상
 * 클라이언트는 그 범위를 넘지 않는다(`quiz.service.ts` `acceptLevel`).
 */

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

/** 이력이 없는 첫 세션의 시작 레벨. 성공 경험(비처벌) 원칙상 낮은 쪽에서 시작한다. */
export const COLD_START_LEVEL = 2;

export type SkillLevel = 1 | 2 | 3 | 4 | 5;

/** 임의의 정수를 유효 레벨 범위 [1..5]로 클램프. */
export function clampLevel(level: number): SkillLevel {
  return Math.max(
    MIN_LEVEL,
    Math.min(MAX_LEVEL, Math.round(level)),
  ) as SkillLevel;
}
