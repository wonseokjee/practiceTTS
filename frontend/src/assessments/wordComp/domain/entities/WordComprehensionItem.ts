/**
 * 단어 이해 (WordComp) 검사 - 문항 엔티티
 *
 * 단일 검사 문항을 나타낸다.
 * choices는 항상 4개이며, 정확히 하나만 isCorrect=true여야 한다.
 * 정답 선택지의 distractorType은 undefined이고, 오답은 DistractorType 값을 가진다.
 */

import type { DistractorType } from '../valueObjects/DistractorType.js';

export interface WordComprehensionChoice {
  readonly choiceId: string;
  readonly word: string;
  readonly imageUrl: string;
  readonly isCorrect: boolean;
  /** 정답 선택지는 undefined, 오답 선택지는 DistractorType 값 */
  readonly distractorType: DistractorType | undefined;
}

export interface WordComprehensionItem {
  readonly itemId: string;
  readonly targetWord: string;
  readonly targetAudioUrl: string;
  readonly category: string;
  /** 항상 4개 선택지 */
  readonly choices: ReadonlyArray<WordComprehensionChoice>;
}
