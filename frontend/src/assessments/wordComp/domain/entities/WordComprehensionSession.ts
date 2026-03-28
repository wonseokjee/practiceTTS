/**
 * 단어 이해 (WordComp) 검사 - 세션 엔티티
 *
 * 하나의 검사 세션 전체를 나타낸다.
 * totalItems는 항상 20이며, itemResults는 제출 순서대로 누적된다.
 * status는 FSM 상태에 따라 갱신된다.
 *
 * 불변 조건:
 * - status === 'completed'이면 completedAt !== null
 */

import type { WordComprehensionItemResult } from './WordComprehensionItemResult.js';

export type SessionStatus = 'in-progress' | 'completed' | 'interrupted';

export interface WordComprehensionSession {
  readonly sessionId: string;
  readonly patientId: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly itemResults: ReadonlyArray<WordComprehensionItemResult>;
  readonly totalItems: number;
  readonly status: SessionStatus;
}
