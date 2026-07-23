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
 * **반응은 했지만 버튼 밖을 짚은 것**이다. 감별진단이 다르다:
 * 무반응은 각성 저하, 영역 외 터치는 시공간·실행 문제를 시사한다.
 *
 * 판정 순서가 중요하다. **반응 유무를 먼저 본다.**
 *
 * 예전에는 touchInBounds만 봤는데, 유스케이스가 무반응(touchTime=null)일 때도
 * touchInBounds를 false로 채운다. 그래서 10초 무반응이 전부 '영역 외 터치'로
 * 기록됐다 — 실제 QA에서 3회 연속 아무것도 누르지 않았는데 세 시도 모두
 * '영역 외 터치'로 남았다. 반응이 없었으면 영역 판정은 **의미가 없다**.
 *
 * @param score  시도 점수
 * @param trial  반응 정보. latency가 null이면 반응 자체가 없었다는 뜻이다.
 *               생략하면 영역 판정 없이 0점을 '무반응'으로 본다.
 */
export function getLocScoreLabel(
  score: LocScoreValue,
  trial?: { latency: number | null; touchInBounds: boolean },
): LocScoreLabel {
  switch (score) {
    case 3:
      return '정상';
    case 2:
      return '경도 지연';
    case 1:
      return '중도 지연';
    case 0:
      // 반응이 없었으면 영역 판정은 의미가 없다 — 무반응이 맞다.
      if (!trial || trial.latency === null) {
        return '무반응';
      }
      return trial.touchInBounds ? '무반응' : '영역 외 터치';
  }
}
