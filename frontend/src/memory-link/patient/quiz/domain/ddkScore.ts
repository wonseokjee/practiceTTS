// 말운동(검사8, DDK) 로컬 채점 — 녹음 음량 포락선(envelope)에서 음절 반복 횟수를 센다.
//
// 음절을 발음할 때마다 음량이 솟구치므로, 동적 임계값을 넘는 "상승 에지"를 음절 1회로 센다.
// 너무 가까운 피크는 한 번으로 묶기 위해 최소 간격(minGapFrames)을 둔다.
// 순수 함수라 합성 신호로 단위 테스트할 수 있다(Web Audio 의존 없음).

export interface CountSyllablesOptions {
  /** 임계값 = 최대값 * 비율 (기본 0.4) */
  thresholdRatio?: number;
  /** 연속 피크로 보지 않을 최소 프레임 간격 (기본 2) */
  minGapFrames?: number;
  /**
   * 발화로 인정할 최소 음량(RMS 0..1, 기본 0.05).
   * 최댓값이 이 값보다 작으면 사실상 무음으로 보고 0을 반환한다.
   * (동적 임계값만 쓰면 무음 속 미세 잡음도 피크로 세어 과대계측되는 것을 방지.)
   */
  minPeakLevel?: number;
}

/** 음량 포락선에서 음절(피크) 횟수를 센다. */
export function countSyllables(
  envelope: readonly number[],
  options?: CountSyllablesOptions,
): number {
  const thresholdRatio = options?.thresholdRatio ?? 0.4;
  const minGapFrames = options?.minGapFrames ?? 2;
  const minPeakLevel = options?.minPeakLevel ?? 0.05;

  let max = 0;
  for (const v of envelope) if (v > max) max = v;
  // 최댓값이 무음 수준이면 잡음으로 보고 0 (동적 임계값 과대계측 방지).
  if (max < minPeakLevel) return 0;

  const threshold = max * thresholdRatio;
  let count = 0;
  let above = false;
  let framesSinceLast = Number.POSITIVE_INFINITY;

  for (const v of envelope) {
    if (!above && v >= threshold && framesSinceLast >= minGapFrames) {
      count += 1;
      above = true;
      framesSinceLast = 0;
    } else if (above && v < threshold) {
      above = false;
    }
    framesSinceLast += 1;
  }
  return count;
}

/** 반복 횟수가 목표 이상이면 통과. */
export function isDdkPass(count: number, targetCount: number): boolean {
  return count >= targetCount;
}
