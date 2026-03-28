/**
 * 단어 이해 (WordComp) 검사 - 반응 시간 값 객체
 *
 * 오디오 종료 시점과 선택지 클릭 시점 사이의 시간 차이를 나타낸다.
 * performance.now() 기준 timestamp를 사용한다.
 *
 * 불변 조건:
 * - durationMs >= 0 (시간 역전 시 WcDomainErrorCode.INVALID_REACTION_TIME 발생)
 */

import {
  WordComprehensionDomainError,
  WcDomainErrorCode,
} from '../errors/WordComprehensionDomainError.js';

export interface ReactionTime {
  readonly audioEndTimestamp: number;
  readonly selectionTimestamp: number;
  readonly durationMs: number;
}

/**
 * ReactionTime 팩토리 함수.
 * selectionTimestamp가 audioEndTimestamp보다 앞서면 에러를 발생시킨다.
 *
 * @param audioEndTimestamp - 오디오 재생 완료 시각 (performance.now() 기준, ms)
 * @param selectionTimestamp - 선택지 클릭 시각 (performance.now() 기준, ms)
 */
export function createReactionTime(
  audioEndTimestamp: number,
  selectionTimestamp: number,
): ReactionTime {
  const durationMs = selectionTimestamp - audioEndTimestamp;

  if (durationMs < 0) {
    throw new WordComprehensionDomainError(
      WcDomainErrorCode.INVALID_REACTION_TIME,
      `선택 시점(${selectionTimestamp})이 오디오 종료 시점(${audioEndTimestamp})보다 앞설 수 없습니다. 차이: ${durationMs}ms`,
    );
  }

  return Object.freeze({ audioEndTimestamp, selectionTimestamp, durationMs });
}
