/**
 * 단어 이해 (WordComp) - 반응 시간 값 객체 단위 테스트
 *
 * 테스트 대상: createReactionTime() 팩토리 함수
 * 의존성 없음 - Mock 불필요
 *
 * 검증 규칙:
 * - durationMs = selectionTimestamp - audioEndTimestamp
 * - durationMs < 0 이면 WcDomainErrorCode.INVALID_REACTION_TIME 에러 발생
 * - durationMs === 0 이면 정상 처리 (selection === audioEnd)
 */

import { describe, it, expect } from 'vitest';
import { createReactionTime } from './ReactionTime.js';
import {
  WordComprehensionDomainError,
  WcDomainErrorCode,
} from '../errors/WordComprehensionDomainError.js';

describe('createReactionTime', () => {
  /**
   * TC-09: 정상 케이스 - audioEndTimestamp=1000, selectionTimestamp=2500
   * 기댓값: durationMs=1500
   */
  it('TC-09: audioEndTimestamp=1000, selectionTimestamp=2500 인 경우 durationMs=1500을 반환한다', () => {
    const result = createReactionTime(1000, 2500);

    expect(result.audioEndTimestamp).toBe(1000);
    expect(result.selectionTimestamp).toBe(2500);
    expect(result.durationMs).toBe(1500);
  });

  /**
   * TC-10: 시간 역전 케이스 - selectionTimestamp < audioEndTimestamp
   * 기댓값: WordComprehensionDomainError 발생 (INVALID_REACTION_TIME)
   */
  it('TC-10: selectionTimestamp가 audioEndTimestamp보다 앞서면 INVALID_REACTION_TIME 에러를 발생시킨다', () => {
    expect(() => createReactionTime(2500, 1000)).toThrow(
      WordComprehensionDomainError,
    );

    try {
      createReactionTime(2500, 1000);
    } catch (err) {
      expect(err).toBeInstanceOf(WordComprehensionDomainError);
      if (err instanceof WordComprehensionDomainError) {
        expect(err.code).toBe(WcDomainErrorCode.INVALID_REACTION_TIME);
      }
    }
  });

  /**
   * TC-11: 경계 케이스 - selection === audioEnd
   * 기댓값: durationMs=0 (정상 처리)
   */
  it('TC-11: selectionTimestamp === audioEndTimestamp 인 경우 durationMs=0으로 정상 처리된다', () => {
    const result = createReactionTime(1500, 1500);

    expect(result.audioEndTimestamp).toBe(1500);
    expect(result.selectionTimestamp).toBe(1500);
    expect(result.durationMs).toBe(0);
  });

  /**
   * 추가 검증: 반환된 값 객체는 동결(freeze)되어 있어야 한다
   */
  it('반환된 ReactionTime 값 객체는 불변(Object.freeze)으로 보호된다', () => {
    const result = createReactionTime(1000, 2000);

    expect(Object.isFrozen(result)).toBe(true);
  });
});
