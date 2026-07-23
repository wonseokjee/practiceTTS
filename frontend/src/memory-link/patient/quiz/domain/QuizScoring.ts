// 퀴즈 점수 표시 헬퍼 (순수 함수)
//
// 서버가 점수를 0..100으로 환산하므로, 클라이언트는 표시/포맷만 담당한다.
// 사이드 이펙트 없이 입력만으로 출력이 결정되는 순수 함수 모음.

/** 만점 기준값 */
const PERFECT_SCORE = 100;

/** 별점 환산 시 최대 별 개수 */
const MAX_STARS = 5;

/** 점수 유효 범위로 보정 (0..100) */
function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  if (score < 0) return 0;
  if (score > PERFECT_SCORE) return PERFECT_SCORE;
  return score;
}

/** 만점 여부 */
export function isPerfect(score: number): boolean {
  return clampScore(score) === PERFECT_SCORE;
}

/**
 * 0..100 점수를 0..5 별 개수로 환산 (반올림).
 * 예: 100 → 5, 80 → 4, 50 → 3(2.5 반올림), 10 → 1(0.5 반올림 → 1)
 */
export function scoreToStars(score: number): number {
  const ratio = clampScore(score) / PERFECT_SCORE;
  return Math.round(ratio * MAX_STARS);
}

/**
 * 점수 구간별 격려 라벨.
 * 환자 대상이므로 항상 긍정적인 톤을 유지한다.
 */
export function scoreLabel(score: number): string {
  const safe = clampScore(score);
  if (safe === PERFECT_SCORE) return '완벽해요!';
  if (safe >= 80) return '아주 잘하셨어요!';
  if (safe >= 60) return '잘하셨어요!';
  if (safe >= 40) return '좋아요, 다시 해볼까요?';
  return '괜찮아요, 천천히 해봐요';
}

/**
 * 표시용 점수 문자열 (정수 + "점").
 * tabular-nums 영역에 그대로 넣을 수 있는 형태.
 */
export function formatScore(score: number): string {
  return `${Math.round(clampScore(score))}점`;
}

/**
 * 이번 점수가 기존 최고점을 넘었는지(표시 보조용).
 * 서버 isNewBest를 우선 신뢰하되, best-score 조회 결과만 있을 때 사용.
 */
export function isImprovement(
  currentScore: number,
  previousBest: number | null,
): boolean {
  if (previousBest === null) return true;
  return clampScore(currentScore) > clampScore(previousBest);
}
