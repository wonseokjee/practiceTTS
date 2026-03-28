/**
 * 단어 이해 (WordComp) 검사 - 세션 요약 계산 유스케이스
 *
 * 책임:
 * 1. sessionId로 세션 조회
 * 2. 도메인 서비스 summarizeSession()으로 통계 집계
 * 3. SessionSummaryDTO로 변환하여 반환
 */

import type { IWordComprehensionRepository } from '../../domain/repositories/IWordComprehensionRepository.js';
import { summarizeSession } from '../../domain/services/WordComprehensionSummarizer.js';
import type { SessionSummaryDTO } from '../dtos/SessionSummaryDTO.js';
import {
  WordComprehensionAppError,
  WcAppErrorCode,
} from '../errors/WordComprehensionAppError.js';

export class CalculateSessionSummaryUseCase {
  constructor(
    private readonly sessionRepository: IWordComprehensionRepository,
  ) {}

  async execute(sessionId: string): Promise<SessionSummaryDTO> {
    const session = await this.sessionRepository.loadSession(sessionId);
    if (session === null) {
      throw new WordComprehensionAppError(
        WcAppErrorCode.SESSION_NOT_FOUND,
        `세션을 찾을 수 없습니다: ${sessionId}`,
      );
    }

    const summary = summarizeSession(session);

    return {
      totalScore: summary.totalScore,
      percentageScore: summary.percentageScore,
      totalItems: session.totalItems,
      distractorPattern: {
        semanticErrorCount: summary.distractorPattern.semanticErrorCount,
        phonemicErrorCount: summary.distractorPattern.phonemicErrorCount,
        unrelatedErrorCount: summary.distractorPattern.unrelatedErrorCount,
        semanticErrorRate: summary.distractorPattern.semanticErrorRate,
        phonemicErrorRate: summary.distractorPattern.phonemicErrorRate,
        unrelatedErrorRate: summary.distractorPattern.unrelatedErrorRate,
      },
      averageReactionTimeMs: summary.averageReactionTimeMs,
      averageReplayCount: summary.averageReplayCount,
    };
  }
}
