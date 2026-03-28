/**
 * LOC 검사 결과 저장소 인터페이스
 *
 * Infrastructure 레이어에서 구현.
 * Application 레이어는 이 인터페이스에만 의존한다.
 */

import type { LocAssessmentResult } from './LocAssessmentResult.js';

export interface ILocResultRepository {
  save(result: LocAssessmentResult): Promise<void>;
  findById(id: string): Promise<LocAssessmentResult | null>;
  findBySessionId(sessionId: string): Promise<LocAssessmentResult | null>;
}
