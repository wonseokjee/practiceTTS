/**
 * 단어 이해 (WordComp) 검사 - 세션 시작 유스케이스
 *
 * 책임:
 * 1. patientId 유효성 검증
 * 2. 전체 문항 로드
 * 3. 각 문항의 choices를 Fisher-Yates 셔플 (매 검사마다 새로 섞기)
 * 4. UUID 생성 및 새 세션 생성/저장
 * 5. 첫 번째 문항 DTO 반환 (정답 은닉, 셔플된 순서)
 */

import type { IWordComprehensionItemRepository } from '../../domain/repositories/IWordComprehensionItemRepository.js';
import { shuffle } from '../../../../shared/domain/shuffle.js';
import type { IWordComprehensionRepository } from '../../domain/repositories/IWordComprehensionRepository.js';
import type { WordComprehensionChoice } from '../../domain/entities/WordComprehensionItem.js';
import type { WordComprehensionSession } from '../../domain/entities/WordComprehensionSession.js';
import type {
  StartSessionRequestDTO,
  StartSessionResponseDTO,
} from '../dtos/StartSessionDTO.js';
import type { WordComprehensionItemDTO } from '../dtos/WordComprehensionItemDTO.js';
import {
  WordComprehensionAppError,
  WcAppErrorCode,
} from '../errors/WordComprehensionAppError.js';

function toChoiceDTOs(choices: ReadonlyArray<WordComprehensionChoice>) {
  return choices.map((c) => ({
    choiceId: c.choiceId,
    word: c.word,
    imageUrl: c.imageUrl,
  }));
}

export class StartWordComprehensionSessionUseCase {
  constructor(
    private readonly itemRepository: IWordComprehensionItemRepository,
    private readonly sessionRepository: IWordComprehensionRepository,
  ) {}

  async execute(dto: StartSessionRequestDTO): Promise<StartSessionResponseDTO> {
    if (dto.patientId.trim().length === 0) {
      throw new WordComprehensionAppError(
        WcAppErrorCode.INVALID_PATIENT,
        'patientId가 유효하지 않습니다.',
      );
    }

    let items;
    try {
      items = await this.itemRepository.loadAll();
    } catch {
      throw new WordComprehensionAppError(
        WcAppErrorCode.ITEM_LOAD_FAILED,
        '문항 데이터를 불러오는 데 실패했습니다.',
      );
    }

    if (items.length === 0) {
      throw new WordComprehensionAppError(
        WcAppErrorCode.ITEM_LOAD_FAILED,
        '문항 데이터가 없습니다.',
      );
    }

    // 각 문항의 선택지를 Fisher-Yates 셔플
    const shuffledItems = items.map((item) => ({
      ...item,
      choices: shuffle(item.choices),
    }));

    const sessionId = crypto.randomUUID();
    const now = new Date();

    const session: WordComprehensionSession = {
      sessionId,
      patientId: dto.patientId,
      startedAt: now,
      completedAt: null,
      itemResults: [],
      totalItems: shuffledItems.length,
      status: 'in-progress',
    };

    await this.sessionRepository.saveSession(session);

    const firstItem = shuffledItems[0];
    const firstItemDTO: WordComprehensionItemDTO = {
      itemId: firstItem.itemId,
      targetWord: firstItem.targetWord,
      targetAudioUrl: firstItem.targetAudioUrl,
      choices: toChoiceDTOs(firstItem.choices),
    };

    return { sessionId, firstItem: firstItemDTO, totalItems: shuffledItems.length };
  }
}
