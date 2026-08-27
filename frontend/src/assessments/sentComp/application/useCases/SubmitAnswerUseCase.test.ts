/**
 * 문장 이해 (SentComp) 검사 - SubmitAnswerUseCase 단위 테스트
 *
 * Mock 저장소를 사용하여 UseCase 로직을 격리 테스트한다.
 *
 * TC-08: audioEndTimestamp=0 → throw SentCompError(AUDIO_NOT_PLAYED)
 * TC-09: itemRepo.findById('bad_id') → null → throw SentCompError(ITEM_NOT_FOUND)
 */

import { describe, it, expect, vi } from 'vitest';
import { SubmitAnswerUseCase } from './SubmitAnswerUseCase.js';
import { SentCompError, SentCompErrorCode } from '../errors.js';
import type { ISentenceComprehensionItemRepository } from '../../domain/ISentenceComprehensionItemRepository.js';
import type { ISentenceComprehensionRepository } from '../../domain/ISentenceComprehensionRepository.js';
import type { SentenceComprehensionItem } from '../../domain/types.js';

// ===== Mock 구현체 =====

function makeMockItem(itemId: string): SentenceComprehensionItem {
  return Object.freeze({
    itemId,
    sentence: `${itemId} 테스트 문장`,
    sentenceAudioUrl: `/audio/${itemId}.mp3`,
    sentenceType: 'reversible' as const,
    choices: [
      { imageUrl: `/img/${itemId}_0.webp`, altText: '선택지 0', isCorrect: true },
      { imageUrl: `/img/${itemId}_1.webp`, altText: '선택지 1', isCorrect: false },
    ] as const,
    orderIndex: 0,
  });
}

function makeItemRepository(
  findByIdResult: SentenceComprehensionItem | null,
  allItems: SentenceComprehensionItem[] = [],
): ISentenceComprehensionItemRepository {
  return {
    loadItems: vi.fn().mockResolvedValue(allItems),
    findById: vi.fn().mockResolvedValue(findByIdResult),
  };
}

function makeResultRepository(): ISentenceComprehensionRepository {
  return {
    saveResult: vi.fn().mockResolvedValue(undefined),
    getResultsBySession: vi.fn().mockResolvedValue([]),
    saveScore: vi.fn().mockResolvedValue(undefined),
    getScore: vi.fn().mockResolvedValue(null),
  };
}

// ===== 테스트 =====

describe('SubmitAnswerUseCase', () => {
  it('TC-08: audioEndTimestamp=0이면 AUDIO_NOT_PLAYED 에러를 던진다', async () => {
    const itemRepo = makeItemRepository(makeMockItem('item_01'), [makeMockItem('item_01')]);
    const resultRepo = makeResultRepository();
    const useCase = new SubmitAnswerUseCase(itemRepo, resultRepo, 'session_01');

    await expect(
      useCase.execute({
        itemId: 'item_01',
        selectedImageIndex: 0,
        audioEndTimestamp: 0, // 오디오 미재생 상태
        selectionTimestamp: 1500,
        replayCount: 0,
      }),
    ).rejects.toThrow(SentCompError);

    await expect(
      useCase.execute({
        itemId: 'item_01',
        selectedImageIndex: 0,
        audioEndTimestamp: 0,
        selectionTimestamp: 1500,
        replayCount: 0,
      }),
    ).rejects.toMatchObject({
      code: SentCompErrorCode.AUDIO_NOT_PLAYED,
    });
  });

  it('TC-09: itemRepo.findById가 null을 반환하면 ITEM_NOT_FOUND 에러를 던진다', async () => {
    const itemRepo = makeItemRepository(null, []); // findById → null
    const resultRepo = makeResultRepository();
    const useCase = new SubmitAnswerUseCase(itemRepo, resultRepo, 'session_01');

    await expect(
      useCase.execute({
        itemId: 'bad_id',
        selectedImageIndex: 0,
        audioEndTimestamp: 1000, // 오디오 재생됨
        selectionTimestamp: 2000,
        replayCount: 0,
      }),
    ).rejects.toThrow(SentCompError);

    await expect(
      useCase.execute({
        itemId: 'bad_id',
        selectedImageIndex: 0,
        audioEndTimestamp: 1000,
        selectionTimestamp: 2000,
        replayCount: 0,
      }),
    ).rejects.toMatchObject({
      code: SentCompErrorCode.ITEM_NOT_FOUND,
    });
  });

  it('정상 제출 시 SubmitAnswerResponseDTO를 반환한다', async () => {
    const item = makeMockItem('item_01');
    const itemRepo = makeItemRepository(item, [item]);
    const resultRepo = makeResultRepository();
    const useCase = new SubmitAnswerUseCase(itemRepo, resultRepo, 'session_01');

    const response = await useCase.execute({
      itemId: 'item_01',
      selectedImageIndex: 0, // choices[0].isCorrect = true → 정답
      audioEndTimestamp: 1000,
      selectionTimestamp: 2000,
      replayCount: 0,
    });

    expect(response.isCorrect).toBe(true);
    expect(response.reactionTimeMs).toBe(1000); // 2000 - 1000
    expect(typeof response.isLastItem).toBe('boolean');
  });

  it('정답이 아닌 선택지를 선택하면 isCorrect=false를 반환한다', async () => {
    const item = makeMockItem('item_01');
    const itemRepo = makeItemRepository(item, [item]);
    const resultRepo = makeResultRepository();
    const useCase = new SubmitAnswerUseCase(itemRepo, resultRepo, 'session_01');

    const response = await useCase.execute({
      itemId: 'item_01',
      selectedImageIndex: 1, // choices[1].isCorrect = false → 오답
      audioEndTimestamp: 1000,
      selectionTimestamp: 2500,
      replayCount: 0,
    });

    expect(response.isCorrect).toBe(false);
    expect(response.reactionTimeMs).toBe(1500); // 2500 - 1000
  });

  it('SAVE_FAILED는 비중단 에러 - 저장 실패해도 ResponseDTO를 반환한다', async () => {
    const item = makeMockItem('item_01');
    const itemRepo = makeItemRepository(item, [item]);
    const resultRepo = makeResultRepository();
    // saveResult를 실패하도록 Mock
    (resultRepo.saveResult as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('localStorage 실패'),
    );

    const useCase = new SubmitAnswerUseCase(itemRepo, resultRepo, 'session_01');

    // 저장 실패해도 에러를 던지지 않고 응답을 반환해야 함
    const response = await useCase.execute({
      itemId: 'item_01',
      selectedImageIndex: 0,
      audioEndTimestamp: 1000,
      selectionTimestamp: 2000,
      replayCount: 0,
    });

    expect(response.isCorrect).toBe(true);
  });

  it('저장된 결과 수 >= 전체 문항 수이면 isLastItem=true를 반환한다', async () => {
    const item = makeMockItem('item_01');
    const itemRepo = makeItemRepository(item, [item]); // 전체 문항 1개
    const resultRepo = makeResultRepository();
    // getResultsBySession: 이미 1개 결과가 저장됨 (현재 제출 포함하여 1개)
    (
      resultRepo.getResultsBySession as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        itemId: 'item_01',
        selectedImageIndex: 0,
        isCorrect: true,
        reactionTimeMs: 1000,
        replayCount: 0,
        audioEndTimestamp: 1000,
        selectionTimestamp: 2000,
      },
    ]);

    const useCase = new SubmitAnswerUseCase(itemRepo, resultRepo, 'session_01');

    const response = await useCase.execute({
      itemId: 'item_01',
      selectedImageIndex: 0,
      audioEndTimestamp: 1000,
      selectionTimestamp: 2000,
      replayCount: 0,
    });

    expect(response.isLastItem).toBe(true);
  });
});
