/**
 * LOC(의식 수준) 채점 도메인 서비스
 *
 * 채점 규칙:
 * - latency == null OR touchInBounds == false → 0점 (무반응 또는 영역 외 터치)
 * - latency ≤ 3,000ms → 3점 (정상)
 * - latency ≤ 6,000ms → 2점 (경도 지연)
 * - latency ≤ 10,000ms → 1점 (중도 지연)
 * - latency > 10,000ms → 0점 (시간 초과)
 *
 * finalScore 산출: 3회 중 최고 점수 채택
 */

export type LocScoreValue = 0 | 1 | 2 | 3;

export const LOC_SCORE_THRESHOLDS = {
  NORMAL: 3_000,
  MILD_DELAY: 6_000,
  MODERATE_DELAY: 10_000,
} as const;

/**
 * 단일 시도 점수를 계산한다.
 */
export function calculateLocScore(
  latency: number | null,
  touchInBounds: boolean,
): LocScoreValue {
  // 무반응 또는 영역 외 터치
  if (latency === null || !touchInBounds) {
    return 0;
  }

  if (latency <= LOC_SCORE_THRESHOLDS.NORMAL) {
    return 3;
  }

  if (latency <= LOC_SCORE_THRESHOLDS.MILD_DELAY) {
    return 2;
  }

  if (latency <= LOC_SCORE_THRESHOLDS.MODERATE_DELAY) {
    return 1;
  }

  // 시간 초과 (> 10,000ms)
  return 0;
}

/**
 * 전체 검사의 최종 점수를 산출한다.
 * 3회 시도 중 최고 점수를 채택한다.
 */
export function calculateFinalLocScore(
  trials: readonly { score: LocScoreValue }[],
): number {
  if (trials.length === 0) {
    return 0;
  }

  return Math.max(...trials.map((t) => t.score));
}

export type LocScoreLabel =
  | '정상'
  | '경도 지연'
  | '중도 지연'
  | '무반응'
  | '영역 외 터치';

/**
 * 점수 값을 한국어 레이블로 변환한다.
 *
 * 0점은 성격이 다른 두 가지를 뭉친다 — **반응이 아예 없었던 것**과
 * **반응은 했지만 버튼 밖을 짚은 것**이다. 점수만 보고 라벨을 붙이면 후자가
 * '무반응'으로 기록돼, 환자가 즉각 반응했는데도 임상 기록은 정반대로 남는다.
 * 그래서 라벨은 touchInBounds까지 함께 본다.
 *
 * @param score          시도 점수
 * @param touchInBounds  버튼 영역 안을 짚었는지. 생략하면 영역 판정 없이
 *                       기존처럼 0점을 '무반응'으로 본다.
 */
export function getLocScoreLabel(
  score: LocScoreValue,
  touchInBounds?: boolean,
): LocScoreLabel {
  switch (score) {
    case 3:
      return '정상';
    case 2:
      return '경도 지연';
    case 1:
      return '중도 지연';
    case 0:
      return touchInBounds === false ? '영역 외 터치' : '무반응';
  }
}
