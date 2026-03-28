/**
 * 단어 이해 (WordComp) 검사 - FSM(유한 상태 기계) 리듀서
 *
 * 피드백 없음 정책: SHOWING_RESULT 상태 없음.
 * 답변 제출 후 바로 다음 문항 로딩으로 전환.
 *
 * 상태 전이 규칙:
 * - LOADING + ITEMS_LOADED → PLAYING
 * - LOADING + ERROR_OCCURRED → ERROR
 * - PLAYING + AUDIO_ENDED → AWAITING (audioEndTimestamp 기록)
 * - PLAYING + ERROR_OCCURRED → ERROR
 * - AWAITING + REPLAY → PLAYING
 * - AWAITING + CHOICE_SELECTED → SUBMITTING (타임스탬프 유지)
 * - AWAITING + ERROR_OCCURRED → ERROR
 * - SUBMITTING + ANSWER_SUBMITTED(in-progress) → TRANSITIONING
 * - SUBMITTING + ANSWER_SUBMITTED(completed) → COMPLETED
 * - SUBMITTING + ERROR_OCCURRED → ERROR
 * - TRANSITIONING + TRANSITION_DONE → LOADING
 * - ERROR + RETRY → LOADING
 */

export type WordCompPhase =
  | { type: 'LOADING' }
  | { type: 'PLAYING' }
  | { type: 'AWAITING'; audioEndTimestamp: number; replayCount: number }
  | { type: 'SUBMITTING'; audioEndTimestamp: number; replayCount: number }
  | { type: 'TRANSITIONING' }
  | { type: 'COMPLETED' }
  | { type: 'ERROR'; message: string };

export type WordCompAction =
  | { type: 'ITEMS_LOADED' }
  | { type: 'AUDIO_ENDED'; audioEndTimestamp: number }
  | { type: 'REPLAY' }
  | { type: 'CHOICE_SELECTED' }
  | { type: 'ANSWER_SUBMITTED'; sessionStatus: 'in-progress' | 'completed' }
  | { type: 'TRANSITION_DONE' }
  | { type: 'ERROR_OCCURRED'; message: string }
  | { type: 'RETRY' };

export function wordCompSessionReducer(
  state: WordCompPhase,
  action: WordCompAction,
): WordCompPhase {
  switch (state.type) {
    case 'LOADING': {
      if (action.type === 'ITEMS_LOADED') return { type: 'PLAYING' };
      if (action.type === 'ERROR_OCCURRED')
        return { type: 'ERROR', message: action.message };
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
      if (action.type === 'ERROR_OCCURRED')
        return { type: 'ERROR', message: action.message };
      return state;
    }

    case 'AWAITING': {
      if (action.type === 'REPLAY') return { type: 'PLAYING' };
      if (action.type === 'CHOICE_SELECTED') {
        return {
          type: 'SUBMITTING',
          audioEndTimestamp: state.audioEndTimestamp,
          replayCount: state.replayCount,
        };
      }
      if (action.type === 'ERROR_OCCURRED')
        return { type: 'ERROR', message: action.message };
      return state;
    }

    case 'SUBMITTING': {
      if (action.type === 'ANSWER_SUBMITTED') {
        if (action.sessionStatus === 'completed') return { type: 'COMPLETED' };
        return { type: 'TRANSITIONING' };
      }
      if (action.type === 'ERROR_OCCURRED')
        return { type: 'ERROR', message: action.message };
      return state;
    }

    case 'TRANSITIONING': {
      if (action.type === 'TRANSITION_DONE') return { type: 'LOADING' };
      return state;
    }

    case 'COMPLETED':
      return state;

    case 'ERROR': {
      if (action.type === 'RETRY') return { type: 'LOADING' };
      return state;
    }
  }
}
