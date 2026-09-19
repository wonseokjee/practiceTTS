// useLocViewModel.ts를 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 TTS 실패·저장 실패 에러 문구가
// 영어로 나온다.

import { renderHook, act, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { useLocViewModel } from './useLocViewModel.js';
import type { LocTrial } from '../domain/LocTrial.js';
import type { LocTrialResponseDTO, LocAssessmentResultDTO } from '../application/dto/LocTrialDTO.js';
import { LocAssessmentError, LocAssessmentErrorCode } from '../application/LocAssessmentError.js';

vi.mock('../../../shared/hooks/useTimer.js', () => ({
  useTimer: () => ({
    remainingSeconds: 0,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}));

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
    scoreLabel: 'mildDelay',
    isComplete: false,
    ...overrides,
  };
}

function makeMockResultDTO(overrides: Partial<LocAssessmentResultDTO> = {}): LocAssessmentResultDTO {
  return {
    id: 'result-1',
    finalScore: 2,
    trials: [makeMockResponseDTO()],
    totalDurationMs: 5000,
    ...overrides,
  };
}

type ExecuteParams = Parameters<InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>['execute']>;
type ExecuteReturn = ReturnType<InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>['execute']>;
type PlayParams = Parameters<InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>['playInstruction']>;
type PlayReturn = ReturnType<InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>['playInstruction']>;
type FinishParams = Parameters<InstanceType<typeof import('../application/FinishLocAssessmentUseCase.js').FinishLocAssessmentUseCase>['execute']>;
type FinishReturn = ReturnType<InstanceType<typeof import('../application/FinishLocAssessmentUseCase.js').FinishLocAssessmentUseCase>['execute']>;

const mockExecute = vi.fn<(...args: ExecuteParams) => ExecuteReturn>();
const mockPlayInstruction = vi.fn<(...args: PlayParams) => PlayReturn>();
const mockFinishExecute = vi.fn<(...args: FinishParams) => FinishReturn>();
const mockCancelInstruction = vi.fn<() => void>();

const mockConductUseCase = {
  execute: mockExecute,
  playInstruction: mockPlayInstruction,
  cancelInstruction: mockCancelInstruction,
} as unknown as InstanceType<typeof import('../application/ConductLocTrialUseCase.js').ConductLocTrialUseCase>;

const mockFinishUseCase = {
  execute: mockFinishExecute,
} as unknown as InstanceType<typeof import('../application/FinishLocAssessmentUseCase.js').FinishLocAssessmentUseCase>;

const mockOnComplete = vi.fn<(resultId: string) => void>();

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

describe('useLocViewModel — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayInstruction.mockResolvedValue(1000);
    mockExecute.mockResolvedValue({
      trial: makeMockTrial(),
      responseDTO: makeMockResponseDTO(),
    });
    mockFinishExecute.mockResolvedValue(makeMockResultDTO());
  });

  it('TTS 실패 시 errorMessage가 영어', async () => {
    mockPlayInstruction.mockRejectedValueOnce(
      new LocAssessmentError(
        LocAssessmentErrorCode.TTS_PLAYBACK_FAILED,
        'tts failed',
      ),
    );

    const { result } = renderLocViewModel();

    await act(async () => { await result.current.actions.startAssessment(); });

    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('IDLE');
    }, { timeout: 3000 });

    expect(result.current.viewState.errorMessage).toBe(
      'Voice playback failed. Please check the device volume.',
    );
  });

  it('저장 실패 시 errorMessage가 영어(점수는 유지)', async () => {
    mockExecute.mockResolvedValue({
      trial: makeMockTrial({ score: 3 }),
      responseDTO: makeMockResponseDTO({ score: 3, isComplete: true }),
    });
    mockFinishExecute.mockRejectedValue(
      new LocAssessmentError(LocAssessmentErrorCode.STORAGE_FAILED, 'storage failed'),
    );

    const { result } = renderLocViewModel();
    await act(async () => { await result.current.actions.startAssessment(); });
    await waitFor(() => {
      expect(result.current.viewState.assessmentState).toBe('AWAITING_TOUCH');
    }, { timeout: 3000 });

    act(() => {
      result.current.actions.handleButtonActivate();
    });

    await waitFor(() =>
      expect(result.current.viewState.assessmentState).toBe('ASSESSMENT_COMPLETE'),
    );
    expect(result.current.viewState.finalScore).not.toBeNull();
    expect(result.current.viewState.errorMessage).toBe(
      "We couldn't save the result. Please write down the score below.",
    );
  });
});
