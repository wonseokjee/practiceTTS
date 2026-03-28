/**
 * 문장 이해 검사 문항 저장소 인터페이스
 *
 * Infrastructure 레이어에서 구현하며, 문항 데이터 로딩과 단건 조회를 제공한다.
 * JSON 파일, 원격 API 등 다양한 구현체로 교체 가능하다.
 */

import type { SentenceComprehensionItem } from './types.js';

export interface ISentenceComprehensionItemRepository {
  /** 전체 문항 목록을 로드한다 */
  loadItems(): Promise<SentenceComprehensionItem[]>;

  /** itemId로 단일 문항을 조회한다. 없으면 null 반환 */
  findById(itemId: string): Promise<SentenceComprehensionItem | null>;
}
