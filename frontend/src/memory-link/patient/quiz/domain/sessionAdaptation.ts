// 세션 내 적응 — 같은 검사 안에서 다음 문항의 눈높이를 바꾼다.
//
// **왜 세션 안인가.** 예전에는 백엔드가 최근 10시행의 정확도로 레벨을 재계산했다.
// 실측 판정 지연이 검사당 5~11세션이었다. 지연 5~11일 · 게인 ±1 · 측정 SNR ≤1인
// 열린 루프인데, 재활 환자의 일간 변동(피로·시간대·투약)은 그보다 훨씬 빠르다.
// 그러면 학습되는 것은 능력이 아니라 최근 며칠의 컨디션 노이즈다.
//
// 세션 안에서 판정하면 지연이 **1문항**이 된다. 그리고 프론트가 무엇을 냈는지
// 알고 있으므로 `presented_level`이 추정값이 아니라 실제 제시값이 된다.
//
// **왜 무오류 학습인가.** 실어증 치료에서 연속 실패는 학습을 방해할 뿐 아니라
// 회피를 만든다. 두 번 틀리면 바로 한 칸 내려 다음 문항을 맞힐 수 있게 하는 것이
// 단서 위계·무오류 학습의 표준 방식이다.

/** 이 수만큼 연속으로 틀리면 한 칸 내린다. */
export const DEMOTE_AFTER_WRONG = 2;

/** 이 수만큼 연속으로 맞히면 한 칸 올린다. */
export const PROMOTE_AFTER_CORRECT = 3;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

function clamp(level: number): number {
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
}

/**
 * 그 검사의 이번 세션 기록으로 **다음 문항에 쓸 레벨**을 정한다(순수).
 *
 * `startLevel`은 세션 시작 시 서버가 준 레벨이고, `trail`은 이번 세션에서 그 검사에
 * 답한 정오답을 순서대로 담은 배열이다.
 *
 * **세션당 한 칸만 움직인다.** 로테이션에서 한 검사는 하루 3문항이라, 상한을 두지
 * 않으면 [오답, 오답, 오답]이 한 세션에 두 칸을 떨어뜨린다. 3시행은 두 칸을 지지할
 * 만한 표본이 아니다. 한 칸으로 묶어도 검사가 주 3회 돌아오므로 예전(5~11세션)보다
 * 훨씬 빠르다.
 *
 * 조정이 한 번 일어나면 그 세션에서는 더 보지 않는다 — 내린 직후의 성공은 "쉬워진
 * 문항을 맞힌 것"이라 승급 근거가 될 수 없다.
 */
export function adaptedLevel(
  startLevel: number,
  trail: readonly boolean[],
): number {
  const level = clamp(Math.round(startLevel));
  let wrongRun = 0;
  let correctRun = 0;

  for (const isCorrect of trail) {
    if (isCorrect) {
      correctRun += 1;
      wrongRun = 0;
    } else {
      wrongRun += 1;
      correctRun = 0;
    }

    if (wrongRun >= DEMOTE_AFTER_WRONG) return clamp(level - 1);
    if (correctRun >= PROMOTE_AFTER_CORRECT) return clamp(level + 1);
  }
  return level;
}

/**
 * 조정이 실제로 일어났는지. 화면에는 노출하지 않고(레벨은 환자에게 비공개)
 * 서버 보고와 로그에만 쓴다.
 */
export function didAdapt(startLevel: number, trail: readonly boolean[]): boolean {
  return adaptedLevel(startLevel, trail) !== clamp(Math.round(startLevel));
}
