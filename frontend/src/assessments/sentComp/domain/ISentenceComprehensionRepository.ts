/**
 * 문장 이해 검사 결과 저장소 인터페이스
 *
 * Infrastructure 레이어에서 구현하며, Application UseCase에서 주입받아 사용한다.
 * 세션별 결과 목록 저장/조회와 최종 채점 결과 저장/조회를 담당한다.
 */

import type {
  SentenceComprehensionResult,
  SentenceComprehensionScore,
} from './types.js';

export interface ISentenceComprehensionRepository {
  /** 단일 문항 응답 결과를 저장한다 */
  saveResult(result: SentenceComprehensionResult): Promise<void>;

  /** 세션의 모든 문항 응답 결과를 조회한다 */
  getResultsBySession(sessionId: string): Promise<SentenceComprehensionResult[]>;

  /** 최종 채점 점수를 저장한다 */
  saveScore(sessionId: string, score: SentenceComprehensionScore): Promise<void>;

  /** 저장된 채점 점수를 조회한다. 없으면 null 반환 */
  getScore(sessionId: string): Promise<SentenceComprehensionScore | null>;
}
