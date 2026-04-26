import type { IRepetitionItemRepository, RepetitionItem } from '../../domain/RepetitionTypes';
import { RepetitionError, RepetitionErrorCode } from '../errors';

export class LoadRepetitionItemsUseCase {
  constructor(private readonly itemRepository: IRepetitionItemRepository) {}

  async execute(): Promise<RepetitionItem[]> {
    try {
      const items = await this.itemRepository.loadItems();
      return [...items].sort((a, b) => a.orderIndex - b.orderIndex);
    } catch (e) {
      throw new RepetitionError(
        RepetitionErrorCode.ITEMS_LOAD_FAILED,
        '문항 목록을 불러오는 데 실패했습니다.'
      );
    }
  }
}
