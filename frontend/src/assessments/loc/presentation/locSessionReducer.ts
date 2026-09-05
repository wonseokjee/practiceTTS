/**
 * LOC 검사 - FSM(유한 상태 기계) 리듀서
 *
 * SentComp/WordComp의 리듀서와 성격이 다르다 — 그쪽은 상태마다 페이로드
 * (audioEndTimestamp, replayCount 등)를 같이 날라야 해서 판별 유니온
 * (`{ type, ...payload }`)을 쓴다. LOC는 시도별 데이터(오디오 종료 시각,
 * 터치 좌표, 누적 시도)를 전부 `useLocViewModel`의 ref가 따로 들고 있어서
 * 상태 자체엔 실을 페이로드가 없다 — 그래서 상태를 문자열 그대로 둔다.
 * `LocAssessmentState`가 이미 `LocScreen.tsx`에서 문자열 비교로 쓰이므로,
 * 이 모양을 지키면 훅 내부만 바꾸고 화면 쪽은 손 안 대도 된다.
 *
 * 상태 전이 규칙:
 * - IDLE + START → TTS_PLAYING
 * - TTS_PLAYING + TTS_READY → AWAITING_TOUCH
 * - TTS_PLAYING + TTS_FAILED(hasTrials) → TRIAL_INTERRUPTED
 * - TTS_PLAYING + TTS_FAILED(!hasTrials) → IDLE
 * - TTS_PLAYING + INTERRUPTED → TRIAL_INTERRUPTED
 * - AWAITING_TOUCH + RESPONSE_REGISTERED → TOUCH_DETECTED (터치·키보드·타임아웃 공통)
 * - AWAITING_TOUCH + INTERRUPTED → TRIAL_INTERRUPTED
 * - TOUCH_DETECTED + TRIAL_SUBMITTED → TRIAL_COMPLETE
 * - TOUCH_DETECTED + TRIAL_SUBMIT_FAILED(hasTrials) → TRIAL_INTERRUPTED
 * - TOUCH_DETECTED + TRIAL_SUBMIT_FAILED(!hasTrials) → IDLE
 * - TRIAL_COMPLETE + NEXT_TRIAL → TTS_PLAYING
 * - TRIAL_COMPLETE + ASSESSMENT_FINISHED → ASSESSMENT_COMPLETE
 * - TRIAL_COMPLETE + INTERRUPTED → TRIAL_INTERRUPTED
 * - TRIAL_INTERRUPTED + RESUME → TTS_PLAYING
 * - ASSESSMENT_COMPLETE + RESET → IDLE
 *
 * 정의되지 않은 전이는 현재 상태를 유지한다.
 */

import type { LocAssessmentState } from './useLocViewModel.js';

export type LocSessionAction =
  | { type: 'START' }
  | { type: 'TTS_READY' }
  | { type: 'TTS_FAILED'; hasTrials: boolean }
  | { type: 'RESPONSE_REGISTERED' }
  | { type: 'TRIAL_SUBMITTED' }
  | { type: 'TRIAL_SUBMIT_FAILED'; hasTrials: boolean }
  | { type: 'NEXT_TRIAL' }
  | { type: 'ASSESSMENT_FINISHED' }
  | { type: 'INTERRUPTED' }
  | { type: 'RESUME' }
  | { type: 'RESET' };

export function locSessionReducer(
  state: LocAssessmentState,
  action: LocSessionAction,
): LocAssessmentState {
  switch (state) {
    case 'IDLE': {
      if (action.type === 'START') return 'TTS_PLAYING';
      return state;
    }

    case 'TTS_PLAYING': {
      if (action.type === 'TTS_READY') return 'AWAITING_TOUCH';
      if (action.type === 'TTS_FAILED') {
        return action.hasTrials ? 'TRIAL_INTERRUPTED' : 'IDLE';
      }
      if (action.type === 'INTERRUPTED') return 'TRIAL_INTERRUPTED';
      return state;
    }

    case 'AWAITING_TOUCH': {
      if (action.type === 'RESPONSE_REGISTERED') return 'TOUCH_DETECTED';
      if (action.type === 'INTERRUPTED') return 'TRIAL_INTERRUPTED';
      return state;
    }

    case 'TOUCH_DETECTED': {
      if (action.type === 'TRIAL_SUBMITTED') return 'TRIAL_COMPLETE';
      if (action.type === 'TRIAL_SUBMIT_FAILED') {
        return action.hasTrials ? 'TRIAL_INTERRUPTED' : 'IDLE';
      }
      return state;
    }

    case 'TRIAL_COMPLETE': {
      if (action.type === 'NEXT_TRIAL') return 'TTS_PLAYING';
      if (action.type === 'ASSESSMENT_FINISHED') return 'ASSESSMENT_COMPLETE';
      if (action.type === 'INTERRUPTED') return 'TRIAL_INTERRUPTED';
      return state;
    }

    case 'TRIAL_INTERRUPTED': {
      if (action.type === 'RESUME') return 'TTS_PLAYING';
      return state;
    }

    case 'ASSESSMENT_COMPLETE': {
      if (action.type === 'RESET') return 'IDLE';
      return state;
    }
  }
}
