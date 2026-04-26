export interface RepetitionItem {
  itemId: string;
  orderIndex: number;
  stimulusText: string;
  sentenceAudioUrl: string;
}

export interface RepetitionResult {
  itemId: string;
  stimulusText: string;
  sttOutput: string;
  cer: number;
  isCorrect: boolean;
  score: 0 | 1 | 2;
  reactionTimeMs: number;
  recordDurationMs: number;
}

export interface IRepetitionItemRepository {
  loadItems(): Promise<RepetitionItem[]>;
}

export interface IRepetitionResultRepository {
  saveResult(sessionId: string, result: RepetitionResult): Promise<void>;
  getResultsBySession(sessionId: string): Promise<RepetitionResult[]>;
}
