/**
 * useLocViewModel 유닛 테스트
 *
 * FSM 상태 전환, 조기 종료, 중복 탭 방지, TTS 실패 처리 등을 검증한다.
 *
 * 모킹 전략:
 * - ConductLocTrialUseCase: vi.mock으로 격리
 * - FinishLocAssessmentUseCase: vi.mock으로 격리
 * - useTimer: vi.mock으로 격리 (RAF 환경 불필요)
 *
 * 타이머 전략:
 * - vi.useFakeTimers()는 waitFor 내부 polling을 차단하므로 사용하지 않는다.
 * - setTimeout 의존성이 있는 테스트는 실제 타이머를 사용하되
 *   INTER_TRIAL_DELAY_MS(700ms)를 고려하여 충분한 대기 시간을 부여한다.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLocViewModel } from './useLocViewModel.js';
import type { LocTrial } from '../domain/LocTrial.js';
import type { LocTrialResponseDTO, LocAssessmentResultDTO } from '../application/dto/LocTrialDTO.js';
import { LocAssessmentError, LocAssessmentErrorCode } from '../application/LocAssessmentError.js';

// ---- useTimer Mock ----
vi.mock('../../../shared/hooks/useTimer.js', () => ({
  useTimer: () => ({
    remainingSeconds: 0,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}));

// ---- 테스트용 LocTrial 팩토리 ----
function makeMockTrial(overrides: Partial<LocTrial> = {}): LocTrial {
  return Object.freeze({
    trialNumber: 1,
    audioEndTime: 1000,
    touchTime: 2000,
    latency: 1000,
    touchInBounds: true,
    score: 2,
    ...overrides,
  }) as LocTrial;
}

function makeMockResponseDTO(overrides: Partial<LocTrialResponseDTO> = {}): LocTrialResponseDTO {
  return {
    trialNumber: 1,
    latencyMs: 1000,
    touchInBounds: true,
    score: 2,
    scoreLabel: '경도 지연',
    isComplete: false,
    ...overrides,
  };
}

function makeMockResultDTO(overrides: Partial<LocAssessmentResultDTO> = {}): LocAssessmentResultDTO {
  return {
    id: 'result-001',
    finalScore: 2,
    trials: [],
    totalDurationMs: 5000,
    ...overrides,
  };
}

// ---- UseCase Mock 설정 ----
type ExecuteParams = Parameters<InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>['execute']>;
type ExecuteReturn = ReturnType<InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>['execute']>;
type PlayParams = Parameters<InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>['playInstruction']>;
type PlayReturn = ReturnType<InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>['playInstruction']>;
type FinishParams = Parameters<InstanceType<typeof import('../application/FinishLocAssessmentUseCase.js').FinishLocAssessmentUseCase>['execute']>;
type FinishReturn = ReturnType<InstanceType<typeof import('../application/FinishLocAssessmentUseCase.js').FinishLocAssessmentUseCase>['execute']>;

const mockExecute = vi.fn<(...args: ExecuteParams) => ExecuteReturn>();
const mockPlayInstruction = vi.fn<(...args: PlayParams) => PlayReturn>();
const mockFinishExecute = vi.fn<(...args: FinishParams) => FinishReturn>();

// ---- 모의 UseCase 인스턴스 ----
const mockCancelInstruction = vi.fn<() => void>();

const mockConductUseCase = {
  execute: mockExecute,
  playInstruction: mockPlayInstruction,
  cancelInstruction: mockCancelInstruction,
} as unknown as InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>;

const mockFinishUseCase = {
  execute: mockFinishExecute,
} as unknown as InstanceType<typeof import('../application/FinishLocAssessmentUseCase.js').FinishLocAssessmentUseCase>;

// ---- 공통 콜백 ----
const mockOnComplete = vi.fn<(resultId: string) => void>();

// ---- 훅 생성 헬퍼 ----
function renderLocViewModel() {
  return renderHook(() =>
    useLocViewModel(
      mockConductUseCase,
      mockFinishUseCase,
      mockOnComplete,
      'test-session-id',
      'P001',
    ),
  );
}

// ---- 포인터 이벤트 모의 객체 ----
// 검사 영역의 pointerdown. 버튼 사각형은 touchButtonRef에서 재므로
// 이벤트에는 좌표만 있으면 된다(ref 미연결 시 영역 안으로 간주).
function makePointerEvent(x = 100, y = 100) {
  return {
    clientX: x,
    clientY: y,
  } as unknown as React.PointerEvent<HTMLElement>;
}

// ---- AWAITING_TOUCH 상태까지 도달하는 헬퍼 ----
async function reachAwaitingTouch(result: ReturnType<typeof renderLocViewModel>['result']) {
  await act(async () => {
    await result.current.actions.startAssessment();
  });
  await waitFor(() => {
    expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH');
  }, { timeout: 3000 });
}

describe('useLocViewModel FSM 상태 전환 테스트', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 기본 성공 응답 설정
    mockPlayInstruction.mockResolvedValue(1000);
    mockExecute.mockResolvedValue({
      trial: makeMockTrial(),
      responseDTO: makeMockResponseDTO(),
    });
    mockFinishExecute.mockResolvedValue(makeMockResultDTO());
  });

  it('1. startAssessment() 호출 시 IDLE → TTS_PLAYING으로 전환된다', async () => {
    // playInstruction을 즉시 resolve하지 않아 TTS_PLAYING 상태를 관측한다
    let resolvePlay!: (value: number) => void;
    mockPlayInstruction.mockReturnValueOnce(
      new Promise<number>((res) => { resolvePlay = res; }),
    );

    const { result } = renderLocViewModel();

    // 초기 상태 확인
    expect(result.current.viewState.assessmentState).toBe('IDLE');

    // startAssessment는 setState만 하고 즉시 반환한다
    act(() => {
      void result.current.actions.startAssessment();
    });

    // setState는 동기적으로 반영되므로 다음 렌더링에서 TTS_PLAYING이 된다
    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('TTS_PLAYING');
    }, { timeout: 3000 });

    // cleanup: promise 해소
    await act(async () => { resolvePlay(1000); });
  });

  it('2. playInstruction() resolve 시 TTS_PLAYING → AWAITING_TOUCH으로 전환된다', async () => {
    const { result } = renderLocViewModel();

    await act(async () => {
      await result.current.actions.startAssessment();
    });

    // playInstruction이 resolve되면 AWAITING_TOUCH로 전환
    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH');
    }, { timeout: 3000 });

    expect(mockPlayInstruction).toHaveBeenCalledWith(1);
  });

  it('3. 반응 입력 시 AWAITING_TOUCH → TOUCH_DETECTED로 전환된다', async () => {
    const { result } = renderLocViewModel();

    await reachAwaitingTouch(result);

    act(() => {
      result.current.actions.handleAreaPointerDown(makePointerEvent());
    });

    expect(result.current.viewState.assessmentState).toBe('TOUCH_DETECTED');
  });

  it('4. 10초 타임아웃 시 touchTime=null로 processTrial이 호출된다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const { result } = renderLocViewModel();

      await act(async () => {
        await result.current.actions.startAssessment();
      });

      await waitFor(() => {
        expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH');
      }, { timeout: 3000 });

      // 10초 타임아웃 발생
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        // 마이크로태스크 flush
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.viewState.assessmentState).not.toBe('AWAITING_TOUCH');
      }, { timeout: 3000 });

      // touchTime=null로 호출되어야 한다
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ touchTime: null }),
        expect.any(Array),
      );
    } finally {
      vi.useRealTimers();
    }
  }, 10000);

  it('5. score=3 달성 시 조기 종료 — 2번째 시도에서 3점이면 3번째 시도 없이 ASSESSMENT_COMPLETE', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      // 첫 번째 시도: 2점 (조기 종료 미발동)
      mockExecute.mockResolvedValueOnce({
        trial: makeMockTrial({ trialNumber: 1, score: 2 }),
        responseDTO: makeMockResponseDTO({ trialNumber: 1, score: 2, isComplete: false }),
      });
      // 두 번째 시도: 3점 (조기 종료 발동)
      mockExecute.mockResolvedValueOnce({
        trial: makeMockTrial({ trialNumber: 2, score: 3 }),
        responseDTO: makeMockResponseDTO({ trialNumber: 2, score: 3, isComplete: false }),
      });
      mockFinishExecute.mockResolvedValue(makeMockResultDTO({ finalScore: 3 }));

      const { result } = renderLocViewModel();

      // 1번째 시도
      await act(async () => {
        await result.current.actions.startAssessment();
      });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });

      await act(async () => {
        result.current.actions.handleAreaPointerDown(makePointerEvent());
      });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('TRIAL_COMPLETE'), { timeout: 3000 });

      // TRIAL_COMPLETE → 다음 시도 전환 (딜레이 경과)
      await act(async () => {
        vi.advanceTimersByTime(700);
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });

      // 2번째 시도 (3점으로 조기 종료 발동)
      await act(async () => {
        result.current.actions.handleAreaPointerDown(makePointerEvent());
      });
      // TRIAL_COMPLETE를 거쳐 바로 ASSESSMENT_COMPLETE로 전환될 수 있으므로
      // 최종 완료 상태만 확인한다
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.viewState.assessmentState).toBe('ASSESSMENT_COMPLETE');
      }, { timeout: 3000 });

      // execute가 2번만 호출되었는지 확인 (3번째 시도 없음)
      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(result.current.viewState.finalScore).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  }, 15000);

  it('6. 3회 시도 후 ASSESSMENT_COMPLETE로 전환된다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      mockExecute
        .mockResolvedValueOnce({
          trial: makeMockTrial({ trialNumber: 1, score: 1 }),
          responseDTO: makeMockResponseDTO({ trialNumber: 1, score: 1 }),
        })
        .mockResolvedValueOnce({
          trial: makeMockTrial({ trialNumber: 2, score: 1 }),
          responseDTO: makeMockResponseDTO({ trialNumber: 2, score: 1 }),
        })
        .mockResolvedValueOnce({
          trial: makeMockTrial({ trialNumber: 3, score: 2 }),
          responseDTO: makeMockResponseDTO({ trialNumber: 3, score: 2, isComplete: true }),
        });

      const { result } = renderLocViewModel();

      // 1번째 시도
      await act(async () => { await result.current.actions.startAssessment(); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });
      await act(async () => { result.current.actions.handleAreaPointerDown(makePointerEvent()); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('TRIAL_COMPLETE'), { timeout: 3000 });

      // 700ms 딜레이 후 2번째 시도
      await act(async () => { vi.advanceTimersByTime(700); await Promise.resolve(); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });
      await act(async () => { result.current.actions.handleAreaPointerDown(makePointerEvent()); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('TRIAL_COMPLETE'), { timeout: 3000 });

      // 700ms 딜레이 후 3번째 시도
      await act(async () => { vi.advanceTimersByTime(700); await Promise.resolve(); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });
      await act(async () => { result.current.actions.handleAreaPointerDown(makePointerEvent()); });
      // 3번째 시도 완료 후 TRIAL_COMPLETE를 거쳐 바로 ASSESSMENT_COMPLETE로 전환될 수 있으므로
      // 최종 완료 상태만 확인한다
      await act(async () => { await Promise.resolve(); });
      await waitFor(() => {
        expect(result.current.viewState.assessmentState).toBe('ASSESSMENT_COMPLETE');
      }, { timeout: 3000 });

      expect(mockExecute).toHaveBeenCalledTimes(3);
      expect(mockFinishExecute).toHaveBeenCalledTimes(1);
      expect(mockOnComplete).toHaveBeenCalledWith('result-001');
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it('7. 중복 탭 방지 — 두 번 탭해도 processTrial은 한 번만 호출된다', async () => {
    const { result } = renderLocViewModel();

    await reachAwaitingTouch(result);

    // 연속 두 번 탭
    act(() => {
      result.current.actions.handleAreaPointerDown(makePointerEvent());
      result.current.actions.handleAreaPointerDown(makePointerEvent());
    });

    // 상태가 변경되어야 한다
    expect(result.current.viewState.assessmentState).toBe('TOUCH_DETECTED');

    await waitFor(() => {
      // processTrial이 완료될 때까지 대기
      expect(mockExecute).toHaveBeenCalled();
    }, { timeout: 3000 });

    // execute는 한 번만 호출되어야 한다
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('8. TTS_PLAYING 상태에서 탭하면 무시된다', async () => {
    // playInstruction을 resolve시키지 않아 TTS_PLAYING 상태 유지
    let resolvePlay!: (value: number) => void;
    mockPlayInstruction.mockReturnValueOnce(
      new Promise<number>((res) => { resolvePlay = res; }),
    );

    const { result } = renderLocViewModel();

    act(() => {
      void result.current.actions.startAssessment();
    });

    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('TTS_PLAYING');
    }, { timeout: 3000 });

    // TTS_PLAYING 상태에서 탭 시도
    act(() => {
      result.current.actions.handleAreaPointerDown(makePointerEvent());
    });

    // 상태가 변하지 않아야 한다
    expect(result.current.viewState.assessmentState).toBe('TTS_PLAYING');
    expect(mockExecute).not.toHaveBeenCalled();

    // cleanup: promise 해소
    await act(async () => { resolvePlay(1000); });
  });

  it('9. TTS 실패 시 errorMessage가 설정되고 IDLE로 복귀한다', async () => {
    mockPlayInstruction.mockRejectedValueOnce(
      new LocAssessmentError(
        LocAssessmentErrorCode.TTS_PLAYBACK_FAILED,
        'TTS 재생 실패',
      ),
    );

    const { result } = renderLocViewModel();

    await act(async () => { await result.current.actions.startAssessment(); });

    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('IDLE');
    }, { timeout: 3000 });

    expect(result.current.viewState.errorMessage).toBe(
      '음성 안내 재생 실패. 기기 음량을 확인해주세요.',
    );
  });

  it('10. proceedToNextAssessment() 호출 시 viewState가 초기값으로 리셋된다', async () => {
    mockPlayInstruction.mockResolvedValue(1000);
    mockExecute.mockResolvedValue({
      trial: makeMockTrial({ score: 3 }),
      responseDTO: makeMockResponseDTO({ score: 3, isComplete: true }),
    });
    mockFinishExecute.mockResolvedValue(makeMockResultDTO({ finalScore: 3 }));

    const { result } = renderLocViewModel();

    // 검사 완료 상태까지 진행
    await act(async () => { await result.current.actions.startAssessment(); });
    await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });
    await act(async () => { result.current.actions.handleAreaPointerDown(makePointerEvent()); });
    await waitFor(() => expect(result.current.viewState.assessmentState).toBe('ASSESSMENT_COMPLETE'), { timeout: 3000 });

    // proceedToNextAssessment 호출 후 상태 리셋 확인
    await act(async () => { result.current.actions.proceedToNextAssessment(); });

    expect(result.current.viewState.assessmentState).toBe('IDLE');
    expect(result.current.viewState.currentTrialNumber).toBe(1);
    expect(result.current.viewState.trialResults).toHaveLength(0);
    expect(result.current.viewState.finalScore).toBeNull();
    expect(result.current.viewState.errorMessage).toBeNull();
  });

  it('11. 이미 끝낸 시도가 있을 때 TTS가 실패하면 IDLE이 아니라 TRIAL_INTERRUPTED로 가고 그 시도를 보존한다', async () => {
    // eng-review에서 지적된 미테스트 가지: TTS_FAILED(hasTrials:true) → TRIAL_INTERRUPTED.
    // 1번째 시도는 끝냈는데(누적 1건) 2번째 시도의 TTS가 실패하는 경우다.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      mockPlayInstruction
        .mockResolvedValueOnce(1000) // 1번째 시도 TTS
        .mockRejectedValueOnce(
          new LocAssessmentError(
            LocAssessmentErrorCode.TTS_PLAYBACK_FAILED,
            'TTS 재생 실패',
          ),
        ); // 2번째 시도 TTS 실패
      mockExecute.mockResolvedValueOnce({
        trial: makeMockTrial({ trialNumber: 1, score: 1 }),
        responseDTO: makeMockResponseDTO({ trialNumber: 1, score: 1, isComplete: false }),
      });

      const { result } = renderLocViewModel();

      await act(async () => { await result.current.actions.startAssessment(); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });
      await act(async () => { result.current.actions.handleAreaPointerDown(makePointerEvent()); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('TRIAL_COMPLETE'), { timeout: 3000 });

      // 700ms 딜레이 후 2번째 시도 TTS 재생 시도 → 실패
      await act(async () => { vi.advanceTimersByTime(700); await Promise.resolve(); });
      await waitFor(() => {
        expect(result.current.viewState.assessmentState).toBe('TRIAL_INTERRUPTED');
      }, { timeout: 3000 });

      // 1번째 시도 점수가 지워지지 않고 남아 있어야 한다.
      expect(result.current.viewState.trialResults).toHaveLength(1);
      expect(result.current.viewState.trialResults[0]?.score).toBe(1);
      expect(result.current.viewState.errorMessage).toBe(
        '음성 안내 재생 실패. 기기 음량을 확인해주세요.',
      );
    } finally {
      vi.useRealTimers();
    }
  }, 15000);

  it('12. 시도 제출(execute) 자체가 실패하면 IDLE로 복귀하고 errorMessage가 설정된다', async () => {
    // eng-review에서 지적된 미테스트 가지: TOUCH_DETECTED + TRIAL_SUBMIT_FAILED → IDLE.
    mockExecute.mockRejectedValueOnce(new Error('저장소 연결 실패'));

    const { result } = renderLocViewModel();

    await reachAwaitingTouch(result);
    await act(async () => { result.current.actions.handleAreaPointerDown(makePointerEvent()); });

    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('IDLE');
    }, { timeout: 3000 });

    expect(result.current.viewState.errorMessage).toBe(
      '오류 발생. 다시 시도해주세요.',
    );
    expect(result.current.viewState.trialResults).toHaveLength(0);
  });
});

/**
 * TODO-006: 탭 전환 시 TTS 중단 및 검사 일시정지.
 *
 * 화면을 벗어나면 안내를 못 듣는데 10초 타이머는 계속 흘러 무응답(0점)으로
 * 잘못 기록됐다. 실어증 환자가 실수로 다른 앱을 건드리는 상황은 흔하고,
 * 0점 한 번이 임상 점수를 왜곡한다.
 */
describe('화면 이탈(탭 전환) 처리', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayInstruction.mockResolvedValue(1000);
    mockExecute.mockResolvedValue({
      trial: makeMockTrial(),
      responseDTO: makeMockResponseDTO(),
    });
    mockFinishExecute.mockResolvedValue(makeMockResultDTO());
    setDocumentHidden(false);
  });

  /** document.hidden을 바꾸고 visibilitychange를 발생시킨다 */
  function setDocumentHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
  }

  function fireVisibilityChange(hidden: boolean) {
    setDocumentHidden(hidden);
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('터치 대기 중 화면을 벗어나면 시도를 기록하지 않고 중단한다', async () => {
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);

    await act(async () => {
      fireVisibilityChange(true);
    });

    expect(result.current.viewState.assessmentState).toBe('TRIAL_INTERRUPTED');
    // 핵심: 무응답(0점)으로 제출되지 않아야 한다
    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.current.viewState.trialResults).toHaveLength(0);
  });

  it('중단 시 재생 중인 TTS를 끊는다', async () => {
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);

    await act(async () => {
      fireVisibilityChange(true);
    });

    expect(mockCancelInstruction).toHaveBeenCalled();
  });

  it('복귀해도 자동 재생하지 않는다 (환자가 준비된 뒤 다시 듣는다)', async () => {
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);
    mockPlayInstruction.mockClear();

    await act(async () => {
      fireVisibilityChange(true);
    });
    await act(async () => {
      fireVisibilityChange(false);
    });

    expect(result.current.viewState.assessmentState).toBe('TRIAL_INTERRUPTED');
    expect(mockPlayInstruction).not.toHaveBeenCalled();
  });

  it('"다시 듣기"로 같은 시도를 처음부터 다시 한다', async () => {
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);
    const trialNumberBefore = result.current.viewState.currentTrialNumber;

    await act(async () => {
      fireVisibilityChange(true);
    });
    mockPlayInstruction.mockClear();

    await act(async () => {
      result.current.actions.resumeInterruptedTrial();
    });

    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH');
    }, { timeout: 3000 });
    expect(mockPlayInstruction).toHaveBeenCalled();
    // 시도 번호가 넘어가지 않는다 — 같은 문제를 다시 듣는 것이다
    expect(result.current.viewState.currentTrialNumber).toBe(trialNumberBefore);
  });

  it('중단 후 터치해도 시도가 제출되지 않는다', async () => {
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);

    await act(async () => {
      fireVisibilityChange(true);
    });
    await act(async () => {
      result.current.actions.handleAreaPointerDown(makePointerEvent());
    });

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('검사 진행 중이 아니면(IDLE) 화면을 벗어나도 아무 일 없다', async () => {
    const { result } = renderLocViewModel();
    expect(result.current.viewState.assessmentState).toBe('IDLE');

    await act(async () => {
      fireVisibilityChange(true);
    });

    expect(result.current.viewState.assessmentState).toBe('IDLE');
    expect(mockCancelInstruction).not.toHaveBeenCalled();
  });
});

/**
 * 리뷰 지적: 시도 간 700ms 대기(TRIAL_COMPLETE) 중에 이탈하면 핸들러가 무시해
 * 타이머가 그대로 흘렀다. 숨은 채로 다음 시도가 시작되어 무응답 0점이 기록된다.
 */
describe('시도 간 대기 중 화면 이탈', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayInstruction.mockResolvedValue(1000);
    mockExecute.mockResolvedValue({
      trial: makeMockTrial(),
      responseDTO: makeMockResponseDTO(),
    });
    mockFinishExecute.mockResolvedValue(makeMockResultDTO());
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
  });

  it('TRIAL_COMPLETE 대기 중 이탈해도 다음 시도가 몰래 시작되지 않는다', async () => {
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);

    // 1회차 응답 → TRIAL_COMPLETE 진입
    await act(async () => {
      result.current.actions.handleAreaPointerDown(makePointerEvent());
    });
    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('TRIAL_COMPLETE');
    }, { timeout: 3000 });

    mockPlayInstruction.mockClear();
    await act(async () => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.viewState.assessmentState).toBe('TRIAL_INTERRUPTED');
    // 700ms 타이머가 살아 있었다면 여기서 TTS가 울렸을 것이다
    await new Promise((r) => setTimeout(r, 1200));
    expect(mockPlayInstruction).not.toHaveBeenCalled();
  });
});

/**
 * 임상 정확성 회귀 — 외부 엔지니어링 리뷰(2026-07-19)에서 나온 3건.
 *
 * 셋 다 "반응은 있었는데 기록은 반대로 남는다" 또는 "끝낸 시도가 사라진다"는
 * 유형이라, 점수가 아니라 **진단**이 틀어진다.
 */
describe('임상 정확성 회귀', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayInstruction.mockResolvedValue(1000);
    mockExecute.mockResolvedValue({
      trial: makeMockTrial(),
      responseDTO: makeMockResponseDTO(),
    });
    mockFinishExecute.mockResolvedValue(makeMockResultDTO());
  });

  /** 검사 영역 pointerdown 이벤트 (버튼 좌표와 무관하게 임의 지점) */
  function makeAreaPointerEvent(x: number, y: number) {
    return { clientX: x, clientY: y } as unknown as React.PointerEvent<HTMLElement>;
  }

  /** touchButtonRef에 지정한 사각형을 가진 가짜 버튼을 연결한다 */
  function attachButton(
    ref: { current: HTMLButtonElement | null },
    rect: { left: number; top: number; width: number; height: number },
  ) {
    ref.current = {
      getBoundingClientRect: () => rect,
    } as unknown as HTMLButtonElement;
  }

  it('버튼 밖을 짚어도 반응으로 기록한다 (무반응으로 오기록 금지)', async () => {
    // 예전에는 리스너가 버튼에 달려 있어 여백 터치가 아예 안 잡혔고,
    // 10초 뒤 '무반응'(각성 저하 소견)으로 기록됐다. 실제로는 환자가
    // 즉시 반응했으나 표적을 빗맞힌 것이다 — 감별진단이 다르다.
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);
    attachButton(result.current.touchButtonRef, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    act(() => {
      // 버튼(0,0,100,100) 바깥 지점
      result.current.actions.handleAreaPointerDown(makeAreaPointerEvent(500, 500));
    });

    expect(result.current.viewState.assessmentState).toBe('TOUCH_DETECTED');
    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
    const [dto] = mockExecute.mock.calls[0];
    // touchTime이 null이 아니어야 '무반응'이 아니다.
    expect(dto.touchTime).not.toBeNull();
    // 좌표가 그대로 전달되어야 유스케이스가 영역 밖으로 판정할 수 있다.
    expect(dto.touchX).toBe(500);
    expect(dto.touchY).toBe(500);
    expect(dto.buttonBounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('버튼 안을 짚으면 영역 안 좌표가 전달된다', async () => {
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);
    attachButton(result.current.touchButtonRef, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    act(() => {
      result.current.actions.handleAreaPointerDown(makeAreaPointerEvent(50, 50));
    });

    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
    const [dto] = mockExecute.mock.calls[0];
    expect(dto.touchX).toBe(50);
    expect(dto.touchY).toBe(50);
  });

  it('키보드로 버튼을 활성화해도 반응으로 기록한다 (0점 오기록 금지)', async () => {
    // 예전에는 버튼에 onPointerDown만 있었다. Enter/Space는 click만
    // 합성하므로 아무 일도 없었고, 스위치 액세스·키보드 사용자는 반응
    // 능력과 무관하게 전원 무반응 0점을 받았다.
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);

    act(() => {
      result.current.actions.handleButtonActivate();
    });

    expect(result.current.viewState.assessmentState).toBe('TOUCH_DETECTED');
    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
    const [dto] = mockExecute.mock.calls[0];
    expect(dto.touchTime).not.toBeNull();
    // 표적을 직접 활성화했으므로 영역 안으로 판정되어야 한다.
    const inBounds =
      dto.touchX >= dto.buttonBounds.x &&
      dto.touchX <= dto.buttonBounds.x + dto.buttonBounds.width &&
      dto.touchY >= dto.buttonBounds.y &&
      dto.touchY <= dto.buttonBounds.y + dto.buttonBounds.height;
    expect(inBounds).toBe(true);
  });

  it('키보드 활성화도 중복 처리되지 않는다', async () => {
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);

    act(() => {
      result.current.actions.handleButtonActivate();
      result.current.actions.handleButtonActivate();
    });

    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
  });

  it('포인터 반응 뒤 따라오는 click은 중복 기록되지 않는다', async () => {
    // 마우스 클릭은 pointerdown → click 순으로 둘 다 발생한다.
    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);
    attachButton(result.current.touchButtonRef, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    act(() => {
      result.current.actions.handleAreaPointerDown(makeAreaPointerEvent(50, 50));
      result.current.actions.handleButtonActivate();
    });

    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
  });

  it('취소된 TTS가 뒤늦게 실패해도 진행 중인 상태를 덮어쓰지 않는다', async () => {
    // 핵심 회귀: cancel()은 오디오를 pause할 뿐 play() 프로미스를 settle하지
    // 않는다. 나중에 settle되면 죽은 경로의 결과가 현재 상태 위에 덮어써져
    // IDLE로 돌아갔고, 검사자가 다시 시작하면 끝낸 시도가 사라졌다.
    let rejectFirst!: (e: unknown) => void;
    mockPlayInstruction.mockReturnValueOnce(
      new Promise<number>((_res, rej) => {
        rejectFirst = rej;
      }),
    );

    const { result } = renderLocViewModel();
    act(() => {
      void result.current.actions.startAssessment();
    });
    await waitFor(() =>
      expect(result.current.viewState.assessmentState).toBe('TTS_PLAYING'),
    );

    // 화면 이탈 → 중단
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.viewState.assessmentState).toBe('TRIAL_INTERRUPTED');

    // 다시 듣기 → 새 세대의 재생 시작
    mockPlayInstruction.mockResolvedValue(1000);
    await act(async () => {
      result.current.actions.resumeInterruptedTrial();
    });
    await waitFor(() =>
      expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'),
    );

    // 이제서야 옛 프로미스가 reject된다 (취소된 오디오가 error를 낸 상황)
    await act(async () => {
      rejectFirst(new Error('stale playback'));
      await Promise.resolve();
    });

    // 죽은 경로가 현재 상태를 건드리면 안 된다.
    expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH');
    expect(result.current.viewState.errorMessage).toBeNull();
  });

  it('저장에 실패해도 끝낸 시도와 점수를 잃지 않는다', async () => {
    // 예전에는 IDLE로 돌아가면서 "계속 진행합니다"라고 안내했다. 검사자가
    // 안내대로 시작을 누르면 누적 시도가 초기화돼 3회 결과가 통째로
    // 사라졌다. 재검사는 학습효과로 점수를 실제보다 좋게 만든다.
    mockExecute.mockResolvedValue({
      trial: makeMockTrial({ score: 3 }),
      responseDTO: makeMockResponseDTO({ score: 3, isComplete: true }),
    });
    mockFinishExecute.mockRejectedValue(
      new LocAssessmentError(LocAssessmentErrorCode.STORAGE_FAILED, '저장 실패'),
    );

    const { result } = renderLocViewModel();
    await reachAwaitingTouch(result);

    act(() => {
      result.current.actions.handleButtonActivate();
    });

    await waitFor(() =>
      expect(result.current.viewState.assessmentState).toBe(
        'ASSESSMENT_COMPLETE',
      ),
    );
    // IDLE로 되돌아가지 않았고, 점수가 화면에 남아 수기 기록이 가능하다.
    expect(result.current.viewState.finalScore).not.toBeNull();
    expect(result.current.viewState.trialResults.length).toBeGreaterThan(0);
    expect(result.current.viewState.errorMessage).toContain('기록');
  });
});
