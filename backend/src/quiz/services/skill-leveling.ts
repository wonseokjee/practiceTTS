/**
 * 스킬별 숙달 레벨링 (순수 도메인 로직).
 *
 * 환자별×스킬(=QAB 서브테스트)별로 1~5단계 난이도를 자동 조절한다. 레벨은
 * 어디에도 "증감 상태"로 저장하지 않고, 매 제출마다 **현재 레벨에서 제시된
 * 최근 윈도우의 정확도**로 결정론적으로 재계산한다(멱등). 중복/재시도 제출이
 * 레벨을 이중으로 움직이지 않는다.
 *
 * 왜 "현재 레벨에서 제시된" 항목만 보는가: 승급하면 다음 세션이 설계상 더
 * 어려워진다. 지난 레벨의 쉬운 결과까지 섞어 재계산하면, 승급 직후의 유도된
 * 정확도 하락을 "환자 퇴행"으로 오독해 곧바로 강등 → 진동한다. presented_level로
 * 능력과 제시 난이도를 분리해 이 교란을 없앤다.
 */
import type { QabSubtest } from '../constants/qab-subtest';

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

/** 이력이 없는 첫 세션의 시작 레벨. 성공 경험(비처벌) 원칙상 낮은 쪽에서 시작한다. */
export const COLD_START_LEVEL = 2;

/** 현재 레벨에서 제시된 항목을 최근 몇 개까지 볼지. */
export const LEVEL_WINDOW = 10;

/** 이 시행 수 미만이면 레벨을 움직이지 않는다(표본 부족 → hold). */
export const MIN_TRIALS = 5;

/** 이 정확도 이상이면 승급(+1). */
export const PROMOTE_ACCURACY = 0.8;

/** 이 정확도 미만이면 강등(-1). 50~79%는 데드밴드(hold). */
export const DEMOTE_ACCURACY = 0.5;

export type SkillLevel = 1 | 2 | 3 | 4 | 5;

/** 레벨링 윈도우의 한 항목. 승강 판정은 정오답 기준(발음 점수는 보호자 추세용). */
export interface LevelingWindowItem {
  isCorrect: boolean;
}

/**
 * 발음 점수(score)를 기록하는 발화 서브테스트. Azure 불가로 score가 null이면
 * 레벨링 윈도우에서 제외해 레벨을 자연 홀드한다(비처벌). ddk는 metric,
 * loc는 반응 기반이라 score-null 제외 대상이 아니다.
 */
export const SPEECH_SCORED_SUBTESTS: readonly QabSubtest[] = [
  'naming',
  'repeat',
  'reading',
] as const;

/** 임의의 정수를 유효 레벨 범위 [1..5]로 클램프. */
export function clampLevel(level: number): SkillLevel {
  return Math.max(
    MIN_LEVEL,
    Math.min(MAX_LEVEL, Math.round(level)),
  ) as SkillLevel;
}

/**
 * 현재 레벨 + 최근 윈도우로 다음 레벨을 계산한다(순수·결정론적·멱등).
 *
 * 규칙:
 *  - window.length < MIN_TRIALS → hold(현재 레벨 유지)
 *  - 정확도 ≥ PROMOTE_ACCURACY → +1 (상한 5)
 *  - 정확도 <  DEMOTE_ACCURACY → -1 (하한 1, 보수적 강등)
 *  - 그 사이(데드밴드) → hold
 *
 * @param currentLevel 현재 레벨(콜드스타트면 COLD_START_LEVEL)
 * @param window 현재 레벨에서 제시된 최근 항목(assisted·발화 score-null 제외된 것)
 */
export function computeLevel(
  currentLevel: SkillLevel,
  window: LevelingWindowItem[],
): SkillLevel {
  if (window.length < MIN_TRIALS) {
    return currentLevel;
  }
  const correct = window.filter((w) => w.isCorrect).length;
  const accuracy = correct / window.length;
  if (accuracy >= PROMOTE_ACCURACY) {
    return clampLevel(currentLevel + 1);
  }
  if (accuracy < DEMOTE_ACCURACY) {
    return clampLevel(currentLevel - 1);
  }
  return currentLevel;
}
