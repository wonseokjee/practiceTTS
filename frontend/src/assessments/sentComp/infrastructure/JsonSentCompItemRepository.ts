/**
 * JSON 데이터 기반 문장 이해 검사 문항 저장소 구현체
 *
 * ISentenceComprehensionItemRepository 인터페이스를 구현한다.
 * 생성자에서 문항 배열을 주입받아 메모리에 보유한다.
 * loadItems()는 전체 배열을 반환하고,
 * findById()는 선형 탐색으로 단건을 조회한다.
 *
 * 데이터 소스 교체(원격 API 등) 시 이 파일만 수정하면 된다.
 */

import type { ISentenceComprehensionItemRepository } from '../domain/ISentenceComprehensionItemRepository.js';
import type { SentenceComprehensionItem } from '../domain/types.js';

export class JsonSentCompItemRepository
  implements ISentenceComprehensionItemRepository
{
  private readonly items: readonly SentenceComprehensionItem[];

  constructor(items: SentenceComprehensionItem[]) {
    this.items = Object.freeze([...items]);
  }

  async loadItems(): Promise<SentenceComprehensionItem[]> {
    return [...this.items];
  }

  async findById(
    itemId: string,
  ): Promise<SentenceComprehensionItem | null> {
    const found = this.items.find((item) => item.itemId === itemId);
    return found ?? null;
  }
}
