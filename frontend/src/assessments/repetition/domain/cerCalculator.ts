/**
 * 한국어 따라말하기 특화 CER(Character Error Rate) 계산기
 * - 띄어쓰기 및 구두점을 모두 제거한 후 순수 글자 단위의 편집 거리로 비교합니다.
 */

export function normalizeKoreanText(text: string): string {
  if (!text) return "";
  // 한글, 영문, 알파벳, 숫자 외 모든 문자(공백 및 구두점 포함) 제거
  return text.replace(/[^가-힣a-zA-Z0-9]/g, "");
}

export function calculateLevenshteinDistance(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]; // 일치
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 대치 (Substitution)
          matrix[i][j - 1] + 1,     // 삽입 (Insertion)
          matrix[i - 1][j] + 1      // 삭제 (Deletion)
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

export function calculateScore(stimulusText: string, sttOutput: string): { cer: number; score: 0 | 1 | 2; isCorrect: boolean } {
  const normalizedStimulus = normalizeKoreanText(stimulusText);
  const normalizedStt = normalizeKoreanText(sttOutput);

  if (normalizedStimulus.length === 0) {
    return { cer: 1, score: 0, isCorrect: false };
  }

  const distance = calculateLevenshteinDistance(normalizedStimulus, normalizedStt);
  const cer = distance / normalizedStimulus.length;

  let score: 0 | 1 | 2 = 0;
  if (distance === 0) {
    score = 2; // 완벽 반복
  } else if (cer <= 0.25) {
    score = 1; // 경미한 오류 (25% 이하 오차)
  } else {
    score = 0; // 심각한 오류
  }

  return {
    cer,
    score,
    isCorrect: score > 0
  };
}
