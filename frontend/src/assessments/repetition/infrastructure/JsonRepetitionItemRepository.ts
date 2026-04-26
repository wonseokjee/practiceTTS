import type { IRepetitionItemRepository, RepetitionItem } from '../domain/RepetitionTypes';

// TS JSON import 에러 방지를 위해 임시로 fetch나 기본 배열을 사용. (설정 환경에 따라 json import 지원 여부 다를 수 있음)
import repetitionItemsData from '../../../assets/data/repetitionItems.json';

export class JsonRepetitionItemRepository implements IRepetitionItemRepository {
  async loadItems(): Promise<RepetitionItem[]> {
    // 네트워크 지연 시뮬레이션
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(repetitionItemsData as RepetitionItem[]);
      }, 300);
    });
  }
}
