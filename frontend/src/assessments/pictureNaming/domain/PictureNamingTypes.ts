export interface PictureNamingItem {
  itemId: string;
  orderIndex: number;
  imageUrl: string;
  expectedWord: string;
}

export interface PictureNamingResult {
  itemId: string;
  expectedWord: string;
  sttOutput: string;       // LLM 판독용 파싱 텍스트
  audioUrl: string | null; // LLM 심층 음향 분석용 실제 녹음 원본
  recordDurationMs: number;
}
