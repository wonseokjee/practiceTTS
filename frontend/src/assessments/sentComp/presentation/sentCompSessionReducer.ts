/**
 * 문장 이해 (SentComp) 검사 - FSM(유한 상태 기계) 리듀서
 *
 * 상태 전이 규칙:
 * - LOADING + ITEMS_LOADED → PLAYING
 * - LOADING + ERROR_OCCURRED → ERROR
 * - PLAYING + AUDIO_ENDED → AWAITING (audioEndTimestamp 기록, replayCount=0 또는 유지)
 * - AWAITING + REPLAY → PLAYING (replayCount++)
 * - AWAITING + IMAGE_SELECTED → SUBMITTING (audioEndTimestamp, replayCount 유지)
 * - SUBMITTING + ANSWER_SUBMITTED → FEEDBACK
 * - SUBMITTING + ERROR_OCCURRED → ERROR
 * - FEEDBACK + FEEDBACK_DONE → isLastItem ? COMPLETED : TRANSITIONING
 * - TRANSITIONING + TRANSITION_DONE → LOADING
 * - ERROR + RETRY → LOADING
 *
 * 정의되지 않은 전이는 현재 상태를 유지한다.
 */

/** FSM 상태 (판별 유니온 타입) */
export type SessionPhase =
  | { type: 'LOADING' }
  | { type: 'PLAYING' }
  | { type: 'AWAITING'; audioEndTimestamp: number; replayCount: number }
  | { type: 'SUBMITTING'; audioEndTimestamp: number; replayCount: number }
  | { type: 'FEEDBACK'; isCorrect: boolean; isLastItem: boolean }
  | { type: 'TRANSITIONING' }
  | { type: 'COMPLETED' }
  | { type: 'ERROR'; message: string };

/** FSM 액션 */
export type SessionAction =
  | { type: 'ITEMS_LOADED' }
  | { type: 'AUDIO_ENDED'; audioEndTimestamp: number }
  | { type: 'REPLAY' }
  | { type: 'IMAGE_SELECTED' }
  | { type: 'ANSWER_SUBMITTED'; isCorrect: boolean; isLastItem: boolean }
  | { type: 'FEEDBACK_DONE' }
  | { type: 'TRANSITION_DONE' }
  | { type: 'ERROR_OCCURRED'; message: string }
  | { type: 'RETRY' };

/**
 * FSM 상태 전이 리듀서
 *
 * @param state - 현재 FSM 상태
 * @param action - 발생한 액션
 * @returns 다음 FSM 상태
 */
export function sentCompSessionReducer(
  state: SessionPhase,
  action: SessionAction,
): SessionPhase {
  switch (state.type) {
    case 'LOADING': {
      if (action.type === 'ITEMS_LOADED') {
        return { type: 'PLAYING' };
      }
      if (action.type === 'ERROR_OCCURRED') {
        return { type: 'ERROR', message: action.message };
      }
      return state;
    }

    case 'PLAYING': {
      if (action.type === 'AUDIO_ENDED') {
        return {
          type: 'AWAITING',
          audioEndTimestamp: action.audioEndTimestamp,
          replayCount: 0,
        };
      }
      if (action.type === 'ERROR_OCCURRED') {
        return { type: 'ERROR', message: action.message };
      }
      return state;
    }

    case 'AWAITING': {
      if (action.type === 'REPLAY') {
        // 재청취 시 replayCount 증가, 다시 PLAYING 상태로
        return { type: 'PLAYING' };
      }
      if (action.type === 'IMAGE_SELECTED') {
        return {
          type: 'SUBMITTING',
          audioEndTimestamp: state.audioEndTimestamp,
          replayCount: state.replayCount,
        };
      }
      if (action.type === 'ERROR_OCCURRED') {
        return { type: 'ERROR', message: action.message };
      }
      return state;
    }

    case 'SUBMITTING': {
      if (action.type === 'ANSWER_SUBMITTED') {
        return {
          type: 'FEEDBACK',
          isCorrect: action.isCorrect,
          isLastItem: action.isLastItem,
        };
      }
      if (action.type === 'ERROR_OCCURRED') {
        return { type: 'ERROR', message: action.message };
      }
      return state;
    }

    case 'FEEDBACK': {
      if (action.type === 'FEEDBACK_DONE') {
        if (state.isLastItem) {
          return { type: 'COMPLETED' };
        }
        return { type: 'TRANSITIONING' };
      }
      return state;
    }

    case 'TRANSITIONING': {
      if (action.type === 'TRANSITION_DONE') {
        return { type: 'LOADING' };
      }
      return state;
    }

    case 'COMPLETED': {
      // COMPLETED는 종단 상태 (재시도 허용하지 않음)
      return state;
    }

    case 'ERROR': {
      if (action.type === 'RETRY') {
        return { type: 'LOADING' };
      }
      return state;
    }
  }
}
