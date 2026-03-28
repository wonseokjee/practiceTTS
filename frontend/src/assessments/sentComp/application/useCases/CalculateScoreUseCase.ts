/**
 * 문장 이해 (SentComp) 검사 - 최종 채점 유스케이스
 *
 * 책임:
 * 1. 세션의 전체 응답 결과를 조회한다.
 * 2. 문항 목록과 함께 SentenceComprehensionScorer.calculateScore()를 호출한다.
 * 3. 채점 결과를 저장한다.
 * 4. ScoreDTO를 반환한다.
 */

import type { ISentenceComprehensionItemRepository } from '../../domain/ISentenceComprehensionItemRepository.js';
import type { ISentenceComprehensionRepository } from '../../domain/ISentenceComprehensionRepository.js';
import { calculateScore } from '../SentenceComprehensionScorer.js';
import type { ScoreDTO } from '../dtos.js';

export class CalculateScoreUseCase {
  private readonly itemRepository: ISentenceComprehensionItemRepository;
  private readonly resultRepository: ISentenceComprehensionRepository;

  constructor(
    itemRepository: ISentenceComprehensionItemRepository,
    resultRepository: ISentenceComprehensionRepository,
  ) {
    this.itemRepository = itemRepository;
    this.resultRepository = resultRepository;
  }

  /**
   * 세션의 채점 결과를 계산하고 저장 후 반환한다.
   *
   * @param sessionId - 채점할 세션 ID
   * @returns ScoreDTO
   */
  async execute(sessionId: string): Promise<ScoreDTO> {
    // 1. 문항 목록 및 결과 조회
    const [items, results] = await Promise.all([
      this.itemRepository.loadItems(),
      this.resultRepository.getResultsBySession(sessionId),
    ]);

    // 2. 도메인 채점 서비스 호출
    const score = calculateScore(items, results);

    // 3. 채점 결과 저장
    await this.resultRepository.saveScore(sessionId, score);

    // 4. ScoreDTO 반환 (도메인 타입을 DTO로 변환)
    const scoreDTO: ScoreDTO = {
      totalScore: score.totalScore,
      correctCount: score.correctCount,
      totalItems: score.totalItems,
      byType: score.byType,
      averageReactionTimeMs: score.averageReactionTimeMs,
      averageReplayCount: score.averageReplayCount,
    };

    return scoreDTO;
  }
}
