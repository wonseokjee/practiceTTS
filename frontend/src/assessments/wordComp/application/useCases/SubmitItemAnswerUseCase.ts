/**
 * 단어 이해 (WordComp) 검사 - 답변 제출 유스케이스
 *
 * 책임:
 * 1. 세션 조회 (없으면 SESSION_NOT_FOUND)
 * 2. 이미 제출된 문항 검증 (ALREADY_ANSWERED)
 * 3. 원본 문항 로드 후 choiceId로 선택지 조회 (없으면 INVALID_CHOICE)
 * 4. scoreItem()으로 정오 판정
 * 5. createReactionTime()으로 반응 시간 계산
 * 6. ItemResult 생성 및 saveItemResult() 저장
 * 7. 마지막 문항이면 completeSession() 호출
 * 8. 다음 문항 DTO 반환 (있으면 새로 셔플, 없으면 null)
 *
 * 피드백 없음 정책: 제출 후 바로 다음 문항으로 이동.
 */

import type { IWordComprehensionRepository } from '../../domain/repositories/IWordComprehensionRepository.js';
import type { IWordComprehensionItemRepository } from '../../domain/repositories/IWordComprehensionItemRepository.js';
import type { WordComprehensionChoice } from '../../domain/entities/WordComprehensionItem.js';
import type { WordComprehensionItemResult } from '../../domain/entities/WordComprehensionItemResult.js';
import type { WordComprehensionItemDTO } from '../dtos/WordComprehensionItemDTO.js';
import type {
  SubmitAnswerRequestDTO,
  SubmitAnswerResponseDTO,
} from '../dtos/SubmitAnswerDTO.js';
import { scoreItem } from '../../domain/services/WordComprehensionScorer.js';
import { createReactionTime } from '../../domain/valueObjects/ReactionTime.js';
import {
  WordComprehensionAppError,
  WcAppErrorCode,
} from '../errors/WordComprehensionAppError.js';

function shuffleChoices(
  choices: ReadonlyArray<WordComprehensionChoice>,
): WordComprehensionChoice[] {
  const arr = [...choices];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

function toChoiceDTOs(choices: ReadonlyArray<WordComprehensionChoice>) {
  return choices.map((c) => ({
    choiceId: c.choiceId,
    word: c.word,
    imageUrl: c.imageUrl,
  }));
}

export class SubmitItemAnswerUseCase {
  constructor(
    private readonly sessionRepository: IWordComprehensionRepository,
    private readonly itemRepository: IWordComprehensionItemRepository,
  ) {}

  async execute(dto: SubmitAnswerRequestDTO): Promise<SubmitAnswerResponseDTO> {
    // 1. 세션 조회
    const session = await this.sessionRepository.loadSession(dto.sessionId);
    if (session === null) {
      throw new WordComprehensionAppError(
        WcAppErrorCode.SESSION_NOT_FOUND,
        `세션을 찾을 수 없습니다: ${dto.sessionId}`,
      );
    }

    // 2. 이미 제출된 문항 검증
    const alreadyAnswered = session.itemResults.some(
      (r) => r.itemId === dto.itemId,
    );
    if (alreadyAnswered) {
      throw new WordComprehensionAppError(
        WcAppErrorCode.ALREADY_ANSWERED,
        `이미 제출된 문항입니다: ${dto.itemId}`,
      );
    }

    // 3. 원본 문항 로드
    const item = await this.itemRepository.loadById(dto.itemId);
    if (item === null) {
      throw new WordComprehensionAppError(
        WcAppErrorCode.ITEM_LOAD_FAILED,
        `문항을 찾을 수 없습니다: ${dto.itemId}`,
      );
    }

    const selectedChoice = item.choices.find((c) => c.choiceId === dto.choiceId);
    if (selectedChoice === undefined) {
      throw new WordComprehensionAppError(
        WcAppErrorCode.INVALID_CHOICE,
        `선택지를 찾을 수 없습니다: ${dto.choiceId}`,
      );
    }

    // 4. 정오 판정
    const score = scoreItem(selectedChoice);

    // 5. 반응 시간 계산
    const reactionTime = createReactionTime(
      dto.audioEndTimestamp,
      dto.selectionTimestamp,
    );

    // 6. ItemResult 생성 및 저장
    const itemResult: WordComprehensionItemResult = {
      itemId: dto.itemId,
      selectedChoiceId: dto.choiceId,
      selectedWord: selectedChoice.word,
      score,
      reactionTime,
      replayCount: dto.replayCount,
      completedAt: new Date(),
    };

    await this.sessionRepository.saveItemResult(dto.sessionId, itemResult);

    // 7. 마지막 문항 여부 판단
    const submittedCount = session.itemResults.length + 1;
    const isLastItem = submittedCount >= session.totalItems;

    if (isLastItem) {
      await this.sessionRepository.completeSession(dto.sessionId, new Date());
    }

    // 8. 다음 문항 결정 (아직 응답하지 않은 문항 중 첫 번째)
    const allItems = await this.itemRepository.loadAll();
    const answeredItemIds = new Set([
      ...session.itemResults.map((r) => r.itemId),
      dto.itemId,
    ]);

    const nextRawItem = allItems.find((i) => !answeredItemIds.has(i.itemId));
    let nextItem: WordComprehensionItemDTO | null = null;

    if (nextRawItem !== undefined && !isLastItem) {
      const shuffledChoices = shuffleChoices(nextRawItem.choices);
      nextItem = {
        itemId: nextRawItem.itemId,
        targetWord: nextRawItem.targetWord,
        targetAudioUrl: nextRawItem.targetAudioUrl,
        choices: toChoiceDTOs(shuffledChoices),
      };
    }

    const currentScore =
      session.itemResults.filter((r) => r.score.isCorrect).length +
      (score.isCorrect ? 1 : 0);

    return {
      isCorrect: score.isCorrect,
      sessionStatus: isLastItem ? 'completed' : 'in-progress',
      nextItem,
      currentScore,
      itemIndex: submittedCount,
    };
  }
}
