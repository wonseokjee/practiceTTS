/**
 * LOC 검사 ViewModel 훅 (FSM 상태 관리)
 *
 * FSM 전이 자체는 `locSessionReducer`(SentComp/WordComp와 같은 useReducer
 * 패턴)가 진다. 이 파일은 그 리듀서를 시도별 데이터(오디오 종료 시각, 터치
 * 좌표, 누적 시도, 타이머)와 엮어 실제 부수효과(TTS 재생, 서버 호출, 화면
 * 이탈 감지)를 실행한다.
 *
 * FSM 상태 전이:
 *   IDLE → TTS_PLAYING → AWAITING_TOUCH → TOUCH_DETECTED → TRIAL_COMPLETE
 *   TRIAL_COMPLETE → TTS_PLAYING (다음 시도) | ASSESSMENT_COMPLETE (완료)
 *
 * 핵심 규칙:
 * - TTS_PLAYING 상태에서만 AWAITING_TOUCH로 전이
 * - AWAITING_TOUCH 상태에서만 반응(터치·키보드) 유효 처리
 * - touchHandledRef 플래그로 첫 번째 pointerdown만 처리 (중복 터치 방지)
 * - AWAITING_TOUCH에서 10초 타임아웃 → touchTime=null 처리
 *
 * Stale Closure 방지:
 * - 타임아웃 콜백 내부에서 state를 직접 참조하지 않고 ref를 통해 접근
 */

import {
  useReducer,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
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
import { calculateFinalLocScore } from '../domain/LocScorer.js';
import { locSessionReducer } from './locSessionReducer.js';

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
  /**
   * 검사 영역 전체의 pointerdown. 버튼 밖을 짚어도 반응으로 잡아
   * '영역 외 터치'와 '무반응'을 구분한다.
   */
  handleAreaPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** 키보드·보조기기로 터치 버튼을 활성화했을 때. */
  handleButtonActivate: () => void;
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
): {
  viewState: LocViewState;
  actions: LocViewModelActions;
  /** 터치 버튼 엘리먼트. 영역 판정을 위해 화면 쪽에서 연결한다. */
  touchButtonRef: React.RefObject<HTMLButtonElement | null>;
} {
  const [assessmentState, dispatch] = useReducer(
    locSessionReducer,
    'IDLE' as LocAssessmentState,
  );
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
  // TTS 재생 세대 — 취소된 재생의 뒤늦은 결과를 무시하는 데 쓴다.
  const ttsGenerationRef = useRef(0);
  // 터치 버튼 엘리먼트 — 영역 판정의 기준 사각형을 여기서 잰다.
  // 리스너가 버튼이 아니라 검사 영역 전체에 달리므로 좌표 비교 대상이 필요하다.
  const touchButtonRef = useRef<HTMLButtonElement | null>(null);
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
        dispatch({ type: 'TRIAL_SUBMITTED' });
      } catch (err) {
        setErrorMessage(mapErrorToMessage(err));
        dispatch({ type: 'TRIAL_SUBMIT_FAILED' });
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
    dispatch({ type: 'RESPONSE_REGISTERED' });

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

      dispatch({ type: 'INTERRUPTED' });
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
          dispatch({ type: 'ASSESSMENT_FINISHED' });
          console.info('[LOC] 검사 완료', { finalScore: resultDTO.finalScore });
          onCompleteRef.current(resultDTO.id);
        } catch (err) {
          console.error('[LOC] 결과 저장 실패', { error: err });
          // IDLE로 돌리면 안 된다. 화면은 "검사를 시작할까요?"가 되고,
          // 검사자가 안내대로 시작을 누르면 startAssessment가
          // accumulatedTrialsRef를 비워 **끝낸 시도가 전부 사라진다**.
          // 재검사는 학습효과로 반응시간을 낮춰 점수를 실제보다 좋게 만든다.
          //
          // 점수는 저장과 무관하게 도메인에서 계산할 수 있으므로, 화면에
          // 남겨 검사자가 수기로 옮겨적을 수 있게 한다.
          setFinalScore(calculateFinalLocScore(allTrials));
          setErrorMessage(
            '결과를 저장하지 못했습니다. 아래 점수를 기록해 주세요.',
          );
          dispatch({ type: 'ASSESSMENT_FINISHED' });
        }
      })();
    } else {
      // 다음 시도로 전환 (700ms 후)
      const nextTrialNumber = (allTrials.length + 1) as 1 | 2 | 3;
      setCurrentTrialNumber(nextTrialNumber);

      interTrialTimeoutIdRef.current = setTimeout(() => {
        dispatch({ type: 'NEXT_TRIAL' });
      }, INTER_TRIAL_DELAY_MS);
    }

    return () => {
      clearInterTrialTimeout();
    };
  }, [assessmentState, clearInterTrialTimeout]);

  /**
   * TTS_PLAYING 상태 진입 시 TTS 재생.
   *
   * 세대(generation) 토큰으로 **죽은 실행 경로의 결과를 무시**한다.
   *
   * 예전에는 가드도 cleanup도 없었다. `cancel()`은 오디오를 pause할 뿐이라
   * `play()` 프로미스가 settle되지 않고 매달려 있는데, 나중에 어떤 이유로든
   * settle되면 그 결과가 **현재 상태 위에 덮어써졌다**. 화면 이탈 후 "다시
   * 듣기"를 누르면 옛 프로미스가 reject되며 catch가 IDLE로 되돌렸고,
   * 검사자가 다시 시작을 누르는 순간 앞선 시도가 조용히 사라졌다.
   */
  useEffect(() => {
    if (assessmentState !== 'TTS_PLAYING') return;

    const trialNumber = currentTrialNumberRef.current;
    const generation = (ttsGenerationRef.current += 1);
    const isStale = () => ttsGenerationRef.current !== generation;

    void (async () => {
      try {
        // audioEndTime: TTS onend 내부에서 performance.now()로 기록된 값
        const audioEndTime =
          await conductTrialUseCaseRef.current.playInstruction(trialNumber);
        if (isStale()) return;
        audioEndTimeRef.current = audioEndTime;
        dispatch({ type: 'TTS_READY' });
      } catch (err) {
        if (isStale()) return;
        console.error('[LOC] TTS 재생 실패', { trialNumber, error: err });
        setErrorMessage(mapErrorToMessage(err));
        // 이미 끝낸 시도가 있으면 IDLE로 돌리지 않는다 — IDLE에서 다시
        // 시작하면 누적 시도가 초기화된다. 중단 화면에서 이어 듣게 한다.
        dispatch({
          type: 'TTS_FAILED',
          hasTrials: accumulatedTrialsRef.current.length > 0,
        });
      }
    })();

    return () => {
      // 이 이펙트를 떠나는 순간 진행 중인 재생을 실제로 끊는다. 안 그러면
      // 안내 음성이 다음 상태까지 이어져 반응시간 기준점이 어긋난다.
      ttsGenerationRef.current += 1;
      conductTrialUseCaseRef.current.cancelInstruction();
    };
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
    dispatch({ type: 'START' });
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
    dispatch({ type: 'RESUME' });
  }, []);

  /**
   * 반응 하나를 확정한다 (터치·키보드 공통).
   *
   * @param touchX/touchY 화면 좌표. 버튼 영역 판정에 쓰인다.
   * @param bounds        버튼의 화면 사각형. null이면 판정을 포기하고
   *                      영역 안으로 간주한다 — 우리 측정 실패를 환자의
   *                      오조준으로 기록하는 편이 훨씬 나쁘다.
   */
  const registerResponse = useCallback(
    (
      touchTime: number,
      touchX: number,
      touchY: number,
      bounds: { x: number; y: number; width: number; height: number } | null,
    ) => {
      touchHandledRef.current = true;
      clearTouchTimeout();
      stopTimer();
      dispatch({ type: 'RESPONSE_REGISTERED' });

      // 측정 불가 시 판정을 통과시키는 사각형을 넘긴다.
      const effectiveBounds = bounds ?? {
        x: touchX,
        y: touchY,
        width: 0,
        height: 0,
      };
      void processTrial(touchTime, touchX, touchY, effectiveBounds);
    },
    [clearTouchTimeout, processTrial, stopTimer],
  );

  /**
   * 검사 영역 어디를 눌러도 반응으로 잡는다.
   *
   * 예전에는 이 핸들러가 **버튼 자신**에 달려 있었다. 그러면 pointerdown이
   * 버튼에서 났다는 것 자체가 좌표가 버튼 안이라는 뜻이라, 영역 판정이
   * 항상 참이 되어 '영역 외 터치'는 만들어질 수 없는 값이었다. 실제로는
   * 정반대 일이 벌어졌다 — 환자가 버튼을 빗맞혀 여백을 짚으면 이벤트가
   * 아예 안 잡혀 10초 뒤 **'무반응'** 으로 기록됐다.
   *
   * 무반응(각성 저하)과 표적 오조준(시공간·실행 문제)은 감별진단이 다르다.
   * 그래서 리스너를 검사 영역 전체로 올리고 좌표로 판정한다.
   */
  const handleAreaPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (assessmentStateRef.current !== 'AWAITING_TOUCH') return;
      if (touchHandledRef.current) return;

      // 반응시간 측정이므로 핸들러 첫 줄에서 시각을 잡는다.
      const touchTime = performance.now();
      const button = touchButtonRef.current;
      registerResponse(
        touchTime,
        event.clientX,
        event.clientY,
        button ? getButtonBounds(button) : null,
      );
    },
    [registerResponse],
  );

  /**
   * 키보드·보조기기로 버튼을 활성화했을 때의 반응.
   *
   * 예전에는 버튼에 `onPointerDown`만 있었다. 키보드 Enter/Space는 `click`만
   * 합성하고 `pointerdown`을 만들지 않으므로 아무 일도 일어나지 않았고,
   * 10초 뒤 무반응 0점이 기록됐다. LOC에서 0점은 '각성 저하' 소견이라,
   * 스위치 액세스·키보드 사용자가 반응 능력과 무관하게 전원 최저점을 받았다.
   *
   * 표적을 직접 활성화한 것이므로 영역 안으로 기록한다.
   */
  const handleButtonActivate = useCallback(() => {
    if (assessmentStateRef.current !== 'AWAITING_TOUCH') return;
    if (touchHandledRef.current) return;

    const touchTime = performance.now();
    registerResponse(touchTime, 0, 0, null);
  }, [registerResponse]);

  /** 다음 검사로 진행 (ASSESSMENT_COMPLETE 상태에서 호출) */
  const proceedToNextAssessment = useCallback(() => {
    // onComplete 콜백은 ASSESSMENT_COMPLETE 진입 시 이미 호출됨
    dispatch({ type: 'RESET' });
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
      handleAreaPointerDown,
      handleButtonActivate,
      proceedToNextAssessment,
      resumeInterruptedTrial,
    }),
    [
      startAssessment,
      handleAreaPointerDown,
      handleButtonActivate,
      proceedToNextAssessment,
      resumeInterruptedTrial,
    ],
  );

  return { viewState, actions, touchButtonRef };
}
