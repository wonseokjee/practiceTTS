/**
 * 단어 이해 (WordComp) 검사 - LocalStorage 세션 저장소 구현체
 *
 * IWordComprehensionRepository 인터페이스를 구현한다.
 * localStorage 키 규칙:
 * - 세션 데이터: 'wordComp_session_{sessionId}'
 *
 * JSON 직렬화/역직렬화로 데이터를 영속화한다.
 * 서버 API 등으로 교체 시 이 파일만 수정하면 된다.
 */

import type { IWordComprehensionRepository } from '../../domain/repositories/IWordComprehensionRepository.js';
import type { WordComprehensionSession } from '../../domain/entities/WordComprehensionSession.js';
import type { WordComprehensionItemResult } from '../../domain/entities/WordComprehensionItemResult.js';

export class LocalStorageWordComprehensionRepository
  implements IWordComprehensionRepository
{
  private sessionKey(sessionId: string): string {
    return `wordComp_session_${sessionId}`;
  }

  async saveSession(session: WordComprehensionSession): Promise<void> {
    try {
      localStorage.setItem(
        this.sessionKey(session.sessionId),
        JSON.stringify(session),
      );
    } catch (err) {
      console.error('[WordCompRepo] 세션 저장 실패:', err);
      throw err;
    }
  }

  async loadSession(
    sessionId: string,
  ): Promise<WordComprehensionSession | null> {
    try {
      const raw = localStorage.getItem(this.sessionKey(sessionId));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as WordComprehensionSession;
      // Date 필드 복원 (JSON 직렬화 시 string으로 변환됨)
      return {
        ...parsed,
        startedAt: new Date(parsed.startedAt),
        completedAt:
          parsed.completedAt !== null ? new Date(parsed.completedAt) : null,
        itemResults: parsed.itemResults.map((r) => ({
          ...r,
          completedAt: new Date(r.completedAt),
        })),
      };
    } catch (err) {
      console.error('[WordCompRepo] 세션 로드 실패:', err);
      return null;
    }
  }

  async saveItemResult(
    sessionId: string,
    result: WordComprehensionItemResult,
  ): Promise<void> {
    try {
      const session = await this.loadSession(sessionId);
      if (session === null) {
        console.warn('[WordCompRepo] saveItemResult: 세션 없음, 건너뜀');
        return;
      }
      const updatedSession: WordComprehensionSession = {
        ...session,
        itemResults: [...session.itemResults, result],
      };
      await this.saveSession(updatedSession);
    } catch (err) {
      console.error('[WordCompRepo] 문항 결과 저장 실패 (계속 진행):', err);
    }
  }

  async completeSession(sessionId: string, completedAt: Date): Promise<void> {
    try {
      const session = await this.loadSession(sessionId);
      if (session === null) {
        console.warn('[WordCompRepo] completeSession: 세션 없음, 건너뜀');
        return;
      }
      const updatedSession: WordComprehensionSession = {
        ...session,
        completedAt,
        status: 'completed',
      };
      await this.saveSession(updatedSession);
    } catch (err) {
      console.error('[WordCompRepo] 세션 완료 처리 실패:', err);
      throw err;
    }
  }
}
