/**
 * LOC(의식 수준) 검사 - 시도(Trial) 값 객체
 *
 * 불변 조건:
 * - trialNumber는 1, 2, 3만 허용
 * - touchTime이 null이면 latency도 null
 * - latency = touchTime - audioEndTime (null이 아닌 경우)
 */

import { calculateLocScore } from './LocScorer.js';
import type { LocScoreValue } from './LocScorer.js';

export type { LocScoreValue };

export interface LocTrial {
  readonly trialNumber: 1 | 2 | 3;
  /** TTS utterance.onend 콜백 내부에서 performance.now()로 측정 */
  readonly audioEndTime: number;
  /** onPointerDown 핸들러 첫 줄에서 performance.now()로 측정. 무응답 시 null */
  readonly touchTime: number | null;
  /** touchTime - audioEndTime. touchTime이 null이면 null */
  readonly latency: number | null;
  readonly touchInBounds: boolean;
  readonly score: LocScoreValue;
}

export function createLocTrial(params: {
  trialNumber: 1 | 2 | 3;
  audioEndTime: number;
  touchTime: number | null;
  touchInBounds: boolean;
}): LocTrial {
  const { trialNumber, audioEndTime, touchTime, touchInBounds } = params;

  // 불변 조건 검증
  if (audioEndTime <= 0) {
    throw new Error(
      `audioEndTime은 양수여야 합니다. 전달된 값: ${audioEndTime}`,
    );
  }

  // latency 계산: touchTime이 null이면 latency도 null
  const latency = touchTime !== null ? touchTime - audioEndTime : null;

  if (latency !== null && latency < 0) {
    throw new Error(
      `touchTime(${touchTime})이 audioEndTime(${audioEndTime})보다 앞설 수 없습니다.`,
    );
  }

  const score = calculateLocScore(latency, touchInBounds);

  const trial: LocTrial = {
    trialNumber,
    audioEndTime,
    touchTime,
    latency,
    touchInBounds,
    score,
  };

  return Object.freeze(trial);
}
