/**
 * LOC(의식 수준) 검사 결과 엔티티
 *
 * 전체 검사(3회 시도)의 집계 결과를 보유한다.
 * 생성 후 불변(Object.freeze) 보장.
 */

import { calculateFinalLocScore } from './LocScorer.js';
import type { LocTrial } from './LocTrial.js';

export interface LocAssessmentResult {
  readonly id: string;
  readonly sessionId: string;
  readonly patientId: string;
  readonly trials: readonly LocTrial[];
  readonly finalScore: number;
  readonly completedAt: Date;
  readonly totalDurationMs: number;
}

export function createLocAssessmentResult(params: {
  id: string;
  sessionId: string;
  patientId: string;
  trials: LocTrial[];
  /** performance.now() 기준 검사 시작 시각 */
  startTime: number;
}): LocAssessmentResult {
  const { id, sessionId, patientId, trials, startTime } = params;

  if (trials.length === 0) {
    throw new Error('시도 결과가 없는 검사 결과를 생성할 수 없습니다.');
  }

  const completedAt = new Date();
  const totalDurationMs = performance.now() - startTime;
  const finalScore = calculateFinalLocScore(trials);

  const result: LocAssessmentResult = {
    id,
    sessionId,
    patientId,
    trials: Object.freeze([...trials]),
    finalScore,
    completedAt,
    totalDurationMs,
  };

  return Object.freeze(result);
}
