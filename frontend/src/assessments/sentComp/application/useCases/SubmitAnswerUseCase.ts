/**
 * 문장 이해 (SentComp) 검사 - 답변 제출 유스케이스
 *
 * 책임:
 * 1. 오디오 미재생 여부 검증 (audioEndTimestamp === 0 → AUDIO_NOT_PLAYED)
 * 2. 문항 조회 (없으면 ITEM_NOT_FOUND)
 * 3. 정오 판정 및 반응시간 계산 (도메인 서비스 위임)
 * 4. SentenceComprehensionResult 생성 및 저장
 * 5. 마지막 문항 여부 판단 후 SubmitAnswerResponseDTO 반환
 *
 * SAVE_FAILED는 비중단 에러: console.error 후 계속 진행한다.
 */

import type { ISentenceComprehensionItemRepository } from '../../domain/ISentenceComprehensionItemRepository.js';
import type { ISentenceComprehensionRepository } from '../../domain/ISentenceComprehensionRepository.js';
import type { SentenceComprehensionResult } from '../../domain/types.js';
import {
  isAnswerCorrect,
  calculateReactionTime,
} from '../SentenceComprehensionScorer.js';
import { SentCompError, SentCompErrorCode } from '../errors.js';
import type { SubmitAnswerRequestDTO, SubmitAnswerResponseDTO } from '../dtos.js';

export class SubmitAnswerUseCase {
  private readonly itemRepository: ISentenceComprehensionItemRepository;
  private readonly resultRepository: ISentenceComprehensionRepository;
  private readonly sessionId: string;

  constructor(
    itemRepository: ISentenceComprehensionItemRepository,
    resultRepository: ISentenceComprehensionRepository,
    sessionId: string,
  ) {
    this.itemRepository = itemRepository;
    this.resultRepository = resultRepository;
    this.sessionId = sessionId;
  }

  async execute(dto: SubmitAnswerRequestDTO): Promise<SubmitAnswerResponseDTO> {
    // 1. 오디오 미재생 검증: audioEndTimestamp가 0이면 오디오를 듣지 않은 것
    if (dto.audioEndTimestamp === 0) {
      throw new SentCompError(
        SentCompErrorCode.AUDIO_NOT_PLAYED,
        '음성을 먼저 들어주세요.',
      );
    }

    // 2. 문항 조회
    const item = await this.itemRepository.findById(dto.itemId);
    if (item === null) {
      throw new SentCompError(
        SentCompErrorCode.ITEM_NOT_FOUND,
        `문항을 찾을 수 없습니다: ${dto.itemId}`,
      );
    }

    // 3. 정오 판정 및 반응시간 계산 (도메인 서비스에 위임)
    const correct = isAnswerCorrect(item, dto.selectedImageIndex);
    const reactionTimeMs = calculateReactionTime(
      dto.audioEndTimestamp,
      dto.selectionTimestamp,
    );

    // 4. 결과 객체 생성
    const result: SentenceComprehensionResult = Object.freeze({
      itemId: dto.itemId,
      selectedImageIndex: dto.selectedImageIndex,
      isCorrect: correct,
      reactionTimeMs,
      replayCount: dto.replayCount,
      audioEndTimestamp: dto.audioEndTimestamp,
      selectionTimestamp: dto.selectionTimestamp,
    });

    // 5. 저장 (SAVE_FAILED는 비중단 에러)
    try {
      await this.resultRepository.saveResult(result);
    } catch (err) {
      console.error('[SubmitAnswerUseCase] 결과 저장 실패 (계속 진행):', err);
    }

    // 6. 마지막 문항 여부 판단
    const allItems = await this.itemRepository.loadItems();
    let isLastItem = false;
    try {
      const savedResults = await this.resultRepository.getResultsBySession(
        this.sessionId,
      );
      isLastItem = savedResults.length >= allItems.length;
    } catch {
      // 조회 실패 시 로드된 문항 수와 현재 결과 수로 추정 (비중단)
      isLastItem = false;
    }

    return Object.freeze({
      isCorrect: correct,
      reactionTimeMs,
      isLastItem,
    });
  }
}
