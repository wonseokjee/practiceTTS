/**
 * 레퍼런스(원본 텍스트)와 STT 분석 결과를 비교하여 Word Error Rate (WER)를 계산합니다.
 */
export function calculateWER(reference: string, hypothesis: string): number {
  const normalize = (text: string) => 
    text.replace(/[.,!?'"]/g, '').trim().split(/\s+/).filter(Boolean);
  
  const refWords = normalize(reference);
  const hypWords = normalize(hypothesis);
  
  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0 : 1;
  }
  
  const m = refWords.length;
  const n = hypWords.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (refWords[i - 1] === hypWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // Deletion
          dp[i][j - 1] + 1,    // Insertion
          dp[i - 1][j - 1] + 1 // Substitution
        );
      }
    }
  }
  
  const distance = dp[m][n];
  const wer = distance / refWords.length;
  // 소수점 4자리까지만 유지 (선택사항)
  return Math.round(wer * 10000) / 10000;
}

/**
 * WER을 기반으로 따라말하기 점수(0~2점)를 산출합니다.
 */
export function scoreRepetitionResult(wer: number): 0 | 1 | 2 {
  if (wer === 0) return 2;
  if (wer <= 0.25) return 1;
  return 0;
}
