/**
 * LOC 검사 ViewModel 훅 (FSM 상태 관리)
 *
 * FSM 상태 전이:
 *   IDLE → TTS_PLAYING → AWAITING_TOUCH → TOUCH_DETECTED → TRIAL_COMPLETE
 *   TRIAL_COMPLETE → TTS_PLAYING (다음 시도) | ASSESSMENT_COMPLETE (완료)
 *
 * 핵심 규칙:
 * - TTS_PLAYING 상태에서만 AWAITING_TOUCH로 전이
 * - AWAITING_TOUCH 상태에서만 handleButtonTouch() 유효 처리
 * - touchHandledRef 플래그로 첫 번째 pointerdown만 처리 (중복 터치 방지)
 * - AWAITING_TOUCH에서 10초 타임아웃 → touchTime=null 처리
 *
 * Stale Closure 방지:
 * - 타임아웃 콜백 내부에서 state를 직접 참조하지 않고 ref를 통해 접근
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import type React from 'react';
import type { ConductLocTrialUseCase } from '../application/ConductLocTrialUseCase.js';
import type { FinishLocAssessmentUseCase } from '../application/FinishLocAssessmentUseCase.js';
import {
  LocAssessmentError,
  LocAssessmentErrorCode,
} from '../application/LocAssessmentError.js';
import type { LocTrialResponseDTO } from '../application/dto/LocTrialDTO.js';
import type { LocTrial } from '../domain/LocTrial.js';
import { useTimer } from '../../../shared/hooks/useTimer.js';

/** FSM 상태 */
export type LocAssessmentState =
  | 'IDLE'
  | 'TTS_PLAYING'
  | 'AWAITING_TOUCH'
  | 'TOUCH_DETECTED'
  | 'TRIAL_COMPLETE'
  /**
   * 화면을 벗어나 현재 시도가 중단됨 (탭 전환·앱 전환·화면 잠금).
   *
   * 안내를 못 들었거나 화면을 보고 있지 않은 채 10초 타이머가 흐르면
   * 무응답(0점)으로 잘못 기록된다. 그래서 시도를 **기록하지 않고** 여기서
   * 멈춘 뒤, 복귀하면 현재 시도만 다시 듣게 한다(앞선 시도는 보존).
   */
  | 'TRIAL_INTERRUPTED'
  | 'ASSESSMENT_COMPLETE';

export interface LocViewState {
  assessmentState: LocAssessmentState;
  currentTrialNumber: number;
  remainingSeconds: number;
  trialResults: LocTrialResponseDTO[];
  finalScore: number | null;
  errorMessage: string | null;
  isTtsPlaying: boolean;
  isButtonEnabled: boolean;
}

export interface LocViewModelActions {
  startAssessment: () => Promise<void>;
  handleButtonTouch: (event: React.PointerEvent<HTMLButtonElement>) => void;
  proceedToNextAssessment: () => void;
  /** 중단된 시도를 다시 듣는다 (TRIAL_INTERRUPTED에서만 동작). */
  resumeInterruptedTrial: () => void;
}

/** 터치 버튼의 화면 좌표를 계산한다 */
function getButtonBounds(element: HTMLButtonElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** 에러 코드를 사용자 메시지로 변환한다 */
function mapErrorToMessage(error: unknown): string {
  if (error instanceof LocAssessmentError) {
    switch (error.code) {
      case LocAssessmentErrorCode.TTS_PLAYBACK_FAILED:
        return '음성 안내 재생 실패. 기기 음량을 확인해주세요.';
      case LocAssessmentErrorCode.STORAGE_FAILED:
        return '저장 실패. 계속 진행합니다.';
      default:
        return '오류 발생. 다시 시도해주세요.';
    }
  }
  return '오류 발생. 다시 시도해주세요.';
}

/** 터치 타임아웃: 10초 */
const TOUCH_TIMEOUT_MS = 10_000;

/** 시도 간 전환 딜레이 (ms) — 설계 문서 기준 700ms */
const INTER_TRIAL_DELAY_MS = 700;

export function useLocViewModel(
  conductTrialUseCase: ConductLocTrialUseCase,
  finishAssessmentUseCase: FinishLocAssessmentUseCase,
  onComplete: (resultId: string) => void,
  sessionId: string,
  patientId: string,
): { viewState: LocViewState; actions: LocViewModelActions } {
  const [assessmentState, setAssessmentState] =
    useState<LocAssessmentState>('IDLE');
  const [currentTrialNumber, setCurrentTrialNumber] = useState<1 | 2 | 3>(1);
  const [trialResults, setTrialResults] = useState<LocTrialResponseDTO[]>([]);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { remainingSeconds, start: startTimer, stop: stopTimer } = useTimer();

  // 시도 도메인 객체 누적 (FinishUseCase 호출 시 전달)
  const accumulatedTrialsRef = useRef<LocTrial[]>([]);
  // audioEndTime: TTS onend에서 기록
  const audioEndTimeRef = useRef<number>(0);
  // 터치 중복 처리 방지 플래그
  const touchHandledRef = useRef(false);
  // 타임아웃 ID
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // inter-trial 전환 타임아웃 ID
  const interTrialTimeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 검사 시작 시각 (performance.now() 기준)
  const assessmentStartTimeRef = useRef<number>(0);

  // Stale closure 방지: state/props를 ref로 미러링
  const assessmentStateRef = useRef<LocAssessmentState>('IDLE');
  const currentTrialNumberRef = useRef<1 | 2 | 3>(1);
  const conductTrialUseCaseRef = useRef(conductTrialUseCase);
  const finishAssessmentUseCaseRef = useRef(finishAssessmentUseCase);
  const onCompleteRef = useRef(onComplete);
  const sessionIdRef = useRef(sessionId);
  const patientIdRef = useRef(patientId);

  // ref를 최신 값으로 동기화
  useEffect(() => {
    assessmentStateRef.current = assessmentState;
  }, [assessmentState]);

  useEffect(() => {
    currentTrialNumberRef.current = currentTrialNumber;
  }, [currentTrialNumber]);

  useEffect(() => {
    conductTrialUseCaseRef.current = conductTrialUseCase;
  }, [conductTrialUseCase]);

  useEffect(() => {
    finishAssessmentUseCaseRef.current = finishAssessmentUseCase;
  }, [finishAssessmentUseCase]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    patientIdRef.current = patientId;
  }, [patientId]);

  const isTtsPlaying = assessmentState === 'TTS_PLAYING';
  const isButtonEnabled = assessmentState === 'AWAITING_TOUCH';

  /** 타임아웃 클리어 헬퍼 */
  const clearTouchTimeout = useCallback(() => {
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  }, []);

  /** inter-trial 타임아웃 클리어 헬퍼 */
  const clearInterTrialTimeout = useCallback(() => {
    if (interTrialTimeoutIdRef.current !== null) {
      clearTimeout(interTrialTimeoutIdRef.current);
      interTrialTimeoutIdRef.current = null;
    }
  }, []);

  /**
   * 시도 결과를 처리하고 다음 상태로 전이한다.
   * 타임아웃과 터치 핸들러 양쪽에서 호출된다.
   */
  const processTrial = useCallback(
    async (touchTime: number | null, touchX: number, touchY: number, buttonBounds: { x: number; y: number; width: number; height: number }) => {
      const trialNumber = currentTrialNumberRef.current;

      try {
        const { trial, responseDTO } =
          await conductTrialUseCaseRef.current.execute(
            {
              trialNumber,
              audioEndTime: audioEndTimeRef.current,
              touchTime,
              touchX,
              touchY,
              buttonBounds,
            },
            accumulatedTrialsRef.current,
          );

        accumulatedTrialsRef.current = [...accumulatedTrialsRef.current, trial];
        setTrialResults((prev) => [...prev, responseDTO]);
        setAssessmentState('TRIAL_COMPLETE');
      } catch (err) {
        setErrorMessage(mapErrorToMessage(err));
        setAssessmentState('IDLE');
      }
    },
    [],
  );

  /** 무응답 처리: touchTime=null로 시도를 제출한다 */
  const handleTimeout = useCallback(async () => {
    // ref를 통해 최신 상태 확인 (stale closure 방지)
    if (assessmentStateRef.current !== 'AWAITING_TOUCH') return;
    if (touchHandledRef.current) return;

    touchHandledRef.current = true;
    stopTimer();
    setAssessmentState('TOUCH_DETECTED');

    await processTrial(null, 0, 0, { x: 0, y: 0, width: 0, height: 0 });
  }, [processTrial, stopTimer]);

  /** AWAITING_TOUCH 상태 진입 시 타이머 시작 */
  useEffect(() => {
    if (assessmentState !== 'AWAITING_TOUCH') return;

    touchHandledRef.current = false;
    startTimer(TOUCH_TIMEOUT_MS);

    timeoutIdRef.current = setTimeout(() => {
      void handleTimeout();
    }, TOUCH_TIMEOUT_MS);

    return () => {
      clearTouchTimeout();
    };
  }, [assessmentState, clearTouchTimeout, handleTimeout, startTimer]);

  /**
   * 화면 이탈 감지 — 진행 중인 시도를 기록하지 않고 중단한다.
   *
   * 탭을 옮기거나 화면이 꺼지면 안내를 못 듣고, 그동안에도 10초 타이머는
   * 계속 흘러 **무응답(0점)으로 잘못 기록**된다. 실어증 환자가 실수로 다른
   * 앱을 건드리는 상황은 충분히 흔하고, 0점 한 번이 임상 점수를 왜곡한다.
   *
   * 그래서 TTS를 끊고 타이머를 정지한 뒤 시도를 버린다. 앞서 끝낸 시도는
   * 그대로 두고, 복귀하면 현재 시도만 다시 듣는다(자동 재생하지 않는다 —
   * 환자가 화면으로 돌아오는 중에 소리가 먼저 나가면 또 놓친다).
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) return;

      const state = assessmentStateRef.current;
      // TRIAL_COMPLETE(시도 간 700ms 대기)도 포함해야 한다. 이 구간을 빼두면
      // 대기 중에 화면을 벗어났을 때 타이머가 그대로 흘러 **숨은 채로**
      // TTS_PLAYING → AWAITING_TOUCH로 진입하고, 안내를 못 들은 10초가 지나
      // 결국 무응답(0점)이 기록된다. 막으려던 바로 그 증상이다.
      if (
        state !== 'TTS_PLAYING' &&
        state !== 'AWAITING_TOUCH' &&
        state !== 'TRIAL_COMPLETE'
      ) {
        return;
      }

      // 지연된 타임아웃 콜백이 뒤늦게 시도를 제출하지 못하도록 먼저 막는다.
      touchHandledRef.current = true;
      clearTouchTimeout();
      clearInterTrialTimeout();
      stopTimer();
      conductTrialUseCaseRef.current.cancelInstruction();

      setAssessmentState('TRIAL_INTERRUPTED');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearTouchTimeout, clearInterTrialTimeout, stopTimer]);

  /** TRIAL_COMPLETE 상태에서 다음 시도 또는 완료 처리 */
  useEffect(() => {
    if (assessmentState !== 'TRIAL_COMPLETE') return;

    const allTrials = accumulatedTrialsRef.current;
    const hasMaxScore = allTrials.some(t => t.score === 3);
    const isLastTrial = allTrials.length >= 3 || hasMaxScore;

    if (isLastTrial) {
      // 검사 완료
      void (async () => {
        try {
          const resultDTO = await finishAssessmentUseCaseRef.current.execute({
            id: `loc-${Date.now()}`,
            sessionId: sessionIdRef.current,
            patientId: patientIdRef.current,
            trials: allTrials,
            startTime: assessmentStartTimeRef.current,
          });
          setFinalScore(resultDTO.finalScore);
          setAssessmentState('ASSESSMENT_COMPLETE');
          console.info('[LOC] 검사 완료', { finalScore: resultDTO.finalScore });
          onCompleteRef.current(resultDTO.id);
        } catch (err) {
          console.error('[LOC] 결과 저장 실패', { error: err });
          setErrorMessage(mapErrorToMessage(err));
          setAssessmentState('IDLE');
        }
      })();
    } else {
      // 다음 시도로 전환 (700ms 후)
      const nextTrialNumber = (allTrials.length + 1) as 1 | 2 | 3;
      setCurrentTrialNumber(nextTrialNumber);

      interTrialTimeoutIdRef.current = setTimeout(() => {
        setAssessmentState('TTS_PLAYING');
      }, INTER_TRIAL_DELAY_MS);
    }

    return () => {
      clearInterTrialTimeout();
    };
  }, [assessmentState, clearInterTrialTimeout]);

  /** TTS_PLAYING 상태 진입 시 TTS 재생 */
  useEffect(() => {
    if (assessmentState !== 'TTS_PLAYING') return;

    const trialNumber = currentTrialNumberRef.current;

    void (async () => {
      try {
        // audioEndTime: TTS onend 내부에서 performance.now()로 기록된 값
        const audioEndTime =
          await conductTrialUseCaseRef.current.playInstruction(trialNumber);
        audioEndTimeRef.current = audioEndTime;
        setAssessmentState('AWAITING_TOUCH');
      } catch (err) {
        console.error('[LOC] TTS 재생 실패', { trialNumber, error: err });
        setErrorMessage(mapErrorToMessage(err));
        setAssessmentState('IDLE');
      }
    })();
    // assessmentState가 TTS_PLAYING으로 바뀔 때만 실행
    // currentTrialNumber는 ref를 통해 최신값을 읽으므로 의존성에서 제외
  }, [assessmentState]);

  /** 검사 시작 */
  const startAssessment = useCallback(async () => {
    if (assessmentStateRef.current !== 'IDLE') {
      throw new LocAssessmentError(
        LocAssessmentErrorCode.ASSESSMENT_ALREADY_COMPLETE,
        '검사가 이미 진행 중입니다.',
      );
    }

    // 상태 초기화
    accumulatedTrialsRef.current = [];
    audioEndTimeRef.current = 0;
    touchHandledRef.current = false;
    assessmentStartTimeRef.current = performance.now();

    setCurrentTrialNumber(1);
    currentTrialNumberRef.current = 1;
    setTrialResults([]);
    setFinalScore(null);
    setErrorMessage(null);
    setAssessmentState('TTS_PLAYING');
  }, []);

  /**
   * 중단된 시도를 다시 듣는다.
   *
   * 시도 번호와 앞선 결과는 그대로 두고 TTS부터 재생한다 — 같은 시도를
   * 처음부터 다시 하는 것이라 반응 시간이 오염되지 않는다.
   */
  const resumeInterruptedTrial = useCallback(() => {
    if (assessmentStateRef.current !== 'TRIAL_INTERRUPTED') return;

    touchHandledRef.current = false;
    audioEndTimeRef.current = 0;
    setErrorMessage(null);
    setAssessmentState('TTS_PLAYING');
  }, []);

  /** 버튼 터치 처리 */
  const handleButtonTouch = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      // AWAITING_TOUCH 상태 가드 (ref로 최신 상태 확인)
      if (assessmentStateRef.current !== 'AWAITING_TOUCH') return;
      // 중복 터치 방지
      if (touchHandledRef.current) return;

      // touchTime: onPointerDown 핸들러 첫 줄에서 즉시 캡처
      const touchTime = performance.now();
      touchHandledRef.current = true;

      clearTouchTimeout();
      stopTimer();

      const button = event.currentTarget;
      const buttonBounds = getButtonBounds(button);
      const touchX = event.clientX;
      const touchY = event.clientY;

      setAssessmentState('TOUCH_DETECTED');

      void processTrial(touchTime, touchX, touchY, buttonBounds);
    },
    [clearTouchTimeout, processTrial, stopTimer],
  );

  /** 다음 검사로 진행 (ASSESSMENT_COMPLETE 상태에서 호출) */
  const proceedToNextAssessment = useCallback(() => {
    // onComplete 콜백은 ASSESSMENT_COMPLETE 진입 시 이미 호출됨
    setAssessmentState('IDLE');
    setCurrentTrialNumber(1);
    currentTrialNumberRef.current = 1;
    setTrialResults([]);
    setFinalScore(null);
    setErrorMessage(null);
    accumulatedTrialsRef.current = [];
  }, []);

  // 컴포넌트 언마운트 시 타임아웃 정리
  useEffect(() => {
    return () => {
      clearTouchTimeout();
      clearInterTrialTimeout();
    };
  }, [clearTouchTimeout, clearInterTrialTimeout]);

  const viewState: LocViewState = useMemo(
    () => ({
      assessmentState,
      currentTrialNumber,
      remainingSeconds,
      trialResults,
      finalScore,
      errorMessage,
      isTtsPlaying,
      isButtonEnabled,
    }),
    [
      assessmentState,
      currentTrialNumber,
      remainingSeconds,
      trialResults,
      finalScore,
      errorMessage,
      isTtsPlaying,
      isButtonEnabled,
    ],
  );

  const actions: LocViewModelActions = useMemo(
    () => ({
      startAssessment,
      handleButtonTouch,
      proceedToNextAssessment,
      resumeInterruptedTrial,
    }),
    [
      startAssessment,
      handleButtonTouch,
      proceedToNextAssessment,
      resumeInterruptedTrial,
    ],
  );

  return { viewState, actions };
}
