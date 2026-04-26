export interface ReadingAloudItem {
  itemId: string;
  orderIndex: number;
  textContent: string; // 이미지 대신 노출될 거대한 글자
}

export interface ReadingAloudResult {
  itemId: string;
  textContent: string;
  isSelfEvaluated: boolean; // 보호자/환자가 판단했는지 마킹
  isCorrect: boolean; // O/X 결과
  recordDurationMs: number;
}
