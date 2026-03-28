/**
 * 문장 이해 (SentComp) 검사 결과 저장소 - LocalStorage 구현체
 *
 * ISentenceComprehensionRepository 인터페이스를 구현한다.
 * localStorage 키 규칙:
 * - 결과 목록: 'sentComp_results_{sessionId}'
 * - 채점 점수: 'sentComp_score_{sessionId}'
 *
 * JSON 직렬화/역직렬화로 데이터를 영속화한다.
 * 다른 저장소(원격 DB 등)로 교체 시 이 파일만 수정하면 된다.
 */

import type { ISentenceComprehensionRepository } from '../domain/ISentenceComprehensionRepository.js';
import type {
  SentenceComprehensionResult,
  SentenceComprehensionScore,
  SentenceType,
  SentenceTypeStats,
} from '../domain/types.js';
import { SentCompError, SentCompErrorCode } from '../application/errors.js';

/**
 * 기본 LocalStorage 저장소 (세션 ID 없이 글로벌 저장)
 * 직접 사용하기보다 SessionLocalStorageSentCompRepository를 사용하는 것을 권장한다.
 * ISentenceComprehensionRepository 인터페이스 완전 구현을 위해 유지한다.
 */
export class LocalStorageSentCompRepository
  implements ISentenceComprehensionRepository
{
  private readonly RESULT_KEY = 'sentComp_all_results';
  private readonly SCORE_PREFIX = 'sentComp_score_';

  async saveResult(result: SentenceComprehensionResult): Promise<void> {
    try {
      const allResults = this.loadAllResults();
      allResults.push(result);
      localStorage.setItem(this.RESULT_KEY, JSON.stringify(allResults));
    } catch (err) {
      throw new SentCompError(
        SentCompErrorCode.SAVE_FAILED,
        '결과 저장에 실패했습니다.',
        err,
      );
    }
  }

  async getResultsBySession(
    _sessionId: string,
  ): Promise<SentenceComprehensionResult[]> {
    try {
      return this.loadAllResults();
    } catch (err) {
      throw new SentCompError(
        SentCompErrorCode.SAVE_FAILED,
        '결과 조회에 실패했습니다.',
        err,
      );
    }
  }

  async saveScore(
    sessionId: string,
    score: SentenceComprehensionScore,
  ): Promise<void> {
    try {
      localStorage.setItem(
        `${this.SCORE_PREFIX}${sessionId}`,
        JSON.stringify(score),
      );
    } catch (err) {
      throw new SentCompError(
        SentCompErrorCode.SAVE_FAILED,
        '채점 결과 저장에 실패했습니다.',
        err,
      );
    }
  }

  async getScore(
    sessionId: string,
  ): Promise<SentenceComprehensionScore | null> {
    try {
      const raw = localStorage.getItem(`${this.SCORE_PREFIX}${sessionId}`);
      if (raw === null) return null;
      return JSON.parse(raw) as SentenceComprehensionScore;
    } catch (err) {
      throw new SentCompError(
        SentCompErrorCode.SAVE_FAILED,
        '채점 결과 조회에 실패했습니다.',
        err,
      );
    }
  }

  private loadAllResults(): SentenceComprehensionResult[] {
    const raw = localStorage.getItem(this.RESULT_KEY);
    if (raw === null) return [];
    return JSON.parse(raw) as SentenceComprehensionResult[];
  }
}

/**
 * 세션 ID를 함께 관리하는 개선된 LocalStorage 저장소
 *
 * ViewModel에서 sessionId를 주입받아 세션별로 결과를 분리 저장한다.
 * useSentCompViewModel에서 sessionId와 함께 생성해 사용한다.
 */
export class SessionLocalStorageSentCompRepository
  implements ISentenceComprehensionRepository
{
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  private resultKey(): string {
    return `sentComp_results_${this.sessionId}`;
  }

  private scoreKey(): string {
    return `sentComp_score_${this.sessionId}`;
  }

  async saveResult(result: SentenceComprehensionResult): Promise<void> {
    try {
      const existing = await this.getResultsBySession(this.sessionId);
      existing.push(result);
      localStorage.setItem(this.resultKey(), JSON.stringify(existing));
    } catch (err) {
      if (err instanceof SentCompError) throw err;
      throw new SentCompError(
        SentCompErrorCode.SAVE_FAILED,
        '결과 저장에 실패했습니다.',
        err,
      );
    }
  }

  async getResultsBySession(
    _sessionId: string,
  ): Promise<SentenceComprehensionResult[]> {
    try {
      const raw = localStorage.getItem(this.resultKey());
      if (raw === null) return [];
      return JSON.parse(raw) as SentenceComprehensionResult[];
    } catch (err) {
      throw new SentCompError(
        SentCompErrorCode.SAVE_FAILED,
        '결과 조회에 실패했습니다.',
        err,
      );
    }
  }

  async saveScore(
    _sessionId: string,
    score: SentenceComprehensionScore,
  ): Promise<void> {
    try {
      localStorage.setItem(this.scoreKey(), JSON.stringify(score));
    } catch (err) {
      throw new SentCompError(
        SentCompErrorCode.SAVE_FAILED,
        '채점 결과 저장에 실패했습니다.',
        err,
      );
    }
  }

  async getScore(
    _sessionId: string,
  ): Promise<SentenceComprehensionScore | null> {
    try {
      const raw = localStorage.getItem(this.scoreKey());
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as {
        totalItems: number;
        correctCount: number;
        totalScore: number;
        byType: Record<
          string,
          { total: number; correct: number; rate: number | null }
        >;
        averageReactionTimeMs: number;
        averageReplayCount: number;
      };
      // byType을 SentenceType Record로 변환
      const sentenceTypes: SentenceType[] = [
        'active-passive',
        'relative-clause',
        'embedded-clause',
      ];
      const byType: Record<SentenceType, SentenceTypeStats> = {} as Record<
        SentenceType,
        SentenceTypeStats
      >;
      for (const st of sentenceTypes) {
        const entry = parsed.byType[st];
        byType[st] = entry ?? { total: 0, correct: 0, rate: null };
      }
      return {
        totalItems: parsed.totalItems,
        correctCount: parsed.correctCount,
        totalScore: parsed.totalScore,
        byType,
        averageReactionTimeMs: parsed.averageReactionTimeMs,
        averageReplayCount: parsed.averageReplayCount,
      };
    } catch (err) {
      throw new SentCompError(
        SentCompErrorCode.SAVE_FAILED,
        '채점 결과 조회에 실패했습니다.',
        err,
      );
    }
  }
}
