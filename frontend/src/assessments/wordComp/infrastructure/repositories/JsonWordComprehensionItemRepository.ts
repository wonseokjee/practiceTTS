/**
 * 단어 이해 (WordComp) 검사 - JSON 기반 문항 저장소 구현체
 *
 * IWordComprehensionItemRepository 인터페이스를 구현한다.
 * 생성자에서 문항 배열을 주입받아 메모리에 보유한다.
 * 데이터 소스 교체(원격 API 등) 시 이 파일만 수정하면 된다.
 */

import type { IWordComprehensionItemRepository } from '../../domain/repositories/IWordComprehensionItemRepository.js';
import type { WordComprehensionItem } from '../../domain/entities/WordComprehensionItem.js';

export class JsonWordComprehensionItemRepository
  implements IWordComprehensionItemRepository
{
  private readonly items: readonly WordComprehensionItem[];

  constructor(items: WordComprehensionItem[]) {
    this.items = Object.freeze([...items]);
  }

  async loadAll(): Promise<WordComprehensionItem[]> {
    return [...this.items];
  }

  async loadById(itemId: string): Promise<WordComprehensionItem | null> {
    const found = this.items.find((item) => item.itemId === itemId);
    return found ?? null;
  }
}
