/**
 * 단어 이해 (WordComp) 검사 - 문항 저장소 인터페이스
 *
 * Infrastructure 레이어에서 구현하며, 문항 데이터 로딩과 단건 조회를 제공한다.
 */

import type { WordComprehensionItem } from '../entities/WordComprehensionItem.js';

export interface IWordComprehensionItemRepository {
  loadAll(): Promise<WordComprehensionItem[]>;
  loadById(itemId: string): Promise<WordComprehensionItem | null>;
}
