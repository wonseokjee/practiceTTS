/**
 * 단어 이해 (WordComp) 검사 - 세션 저장소 인터페이스
 *
 * Infrastructure 레이어에서 구현하며, Application UseCase에서 주입받아 사용한다.
 */

import type { WordComprehensionSession } from '../entities/WordComprehensionSession.js';
import type { WordComprehensionItemResult } from '../entities/WordComprehensionItemResult.js';

export interface IWordComprehensionRepository {
  saveSession(session: WordComprehensionSession): Promise<void>;
  loadSession(sessionId: string): Promise<WordComprehensionSession | null>;
  saveItemResult(
    sessionId: string,
    result: WordComprehensionItemResult,
  ): Promise<void>;
  completeSession(sessionId: string, completedAt: Date): Promise<void>;
}
