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

const mockExecute = vi.fn<ExecuteParams, ExecuteReturn>();
const mockPlayInstruction = vi.fn<PlayParams, PlayReturn>();
const mockFinishExecute = vi.fn<FinishParams, FinishReturn>();

// ---- 모의 UseCase 인스턴스 ----
const mockConductUseCase = {
  execute: mockExecute,
  playInstruction: mockPlayInstruction,
} as unknown as InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>;

const mockFinishUseCase = {
  execute: mockFinishExecute,
} as unknown as InstanceType<typeof import('../application/FinishLocAssessmentUseCase.js').FinishLocAssessmentUseCase>;

// ---- 공통 콜백 ----
const mockOnComplete = vi.fn<[string], void>();

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
function makePointerEvent(x = 100, y = 100) {
  return {
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    },
    clientX: x,
    clientY: y,
  } as unknown as React.PointerEvent<HTMLButtonElement>;
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

  it('3. handleButtonTouch() 호출 시 AWAITING_TOUCH → TOUCH_DETECTED로 전환된다', async () => {
    const { result } = renderLocViewModel();

    await reachAwaitingTouch(result);

    act(() => {
      result.current.actions.handleButtonTouch(makePointerEvent());
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
        result.current.actions.handleButtonTouch(makePointerEvent());
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
        result.current.actions.handleButtonTouch(makePointerEvent());
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
      await act(async () => { result.current.actions.handleButtonTouch(makePointerEvent()); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('TRIAL_COMPLETE'), { timeout: 3000 });

      // 700ms 딜레이 후 2번째 시도
      await act(async () => { vi.advanceTimersByTime(700); await Promise.resolve(); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });
      await act(async () => { result.current.actions.handleButtonTouch(makePointerEvent()); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('TRIAL_COMPLETE'), { timeout: 3000 });

      // 700ms 딜레이 후 3번째 시도
      await act(async () => { vi.advanceTimersByTime(700); await Promise.resolve(); });
      await waitFor(() => expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH'), { timeout: 3000 });
      await act(async () => { result.current.actions.handleButtonTouch(makePointerEvent()); });
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
      result.current.actions.handleButtonTouch(makePointerEvent());
      result.current.actions.handleButtonTouch(makePointerEvent());
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
      result.current.actions.handleButtonTouch(makePointerEvent());
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
    await act(async () => { result.current.actions.handleButtonTouch(makePointerEvent()); });
    await waitFor(() => expect(result.current.viewState.assessmentState).toBe('ASSESSMENT_COMPLETE'), { timeout: 3000 });

    // proceedToNextAssessment 호출 후 상태 리셋 확인
    await act(async () => { result.current.actions.proceedToNextAssessment(); });

    expect(result.current.viewState.assessmentState).toBe('IDLE');
    expect(result.current.viewState.currentTrialNumber).toBe(1);
    expect(result.current.viewState.trialResults).toHaveLength(0);
    expect(result.current.viewState.finalScore).toBeNull();
    expect(result.current.viewState.errorMessage).toBeNull();
  });
});
