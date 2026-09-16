// 의식 수준(LOC) 검사 메인 화면을 영어로 그린다(영어판 Phase 1-2)
//
// useLocViewModel은 오디오·리포지토리·유스케이스를 실제로 조립하는 무거운
// 훅이라 전체 FSM을 통과시키는 렌더 테스트 대신, 훅 자체를 모킹해
// assessmentState별로 문구만 확인한다(WordComprehensionScreen 배치와
// 같은 방식).
//
// 검증 포인트: 활성 로케일이 en-US면 state별 문구가 영어로 나오고
// 한글이 새지 않는다(scoreLabel은 도메인이 만드는 한글이라 제외).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { LocScreen } from './LocScreen.js';
import type { LocViewModelActions, LocViewState } from './useLocViewModel.js';

vi.mock('../../../shared/session/SessionContext.js', () => ({
  useSessionContext: () => ({
    session: { sessionId: 's1', patientId: 'p1', patientName: 'Jane' },
    endSession: vi.fn(),
  }),
}));

const useLocViewModel = vi.hoisted(() => vi.fn());
vi.mock('./useLocViewModel.js', () => ({
  useLocViewModel: (...args: unknown[]) => useLocViewModel(...args),
}));

const actions: LocViewModelActions = {
  startAssessment: vi.fn(),
  handleAreaPointerDown: vi.fn(),
  handleButtonActivate: vi.fn(),
  proceedToNextAssessment: vi.fn(),
  resumeInterruptedTrial: vi.fn(),
};

function stateWith(over: Partial<LocViewState>): LocViewState {
  return {
    assessmentState: 'IDLE',
    currentTrialNumber: 1,
    remainingSeconds: 10,
    trialResults: [],
    finalScore: null,
    errorMessage: null,
    isTtsPlaying: false,
    isButtonEnabled: true,
    ...over,
  };
}

const HANGUL = /[가-힣]/;

describe('LOC 검사 메인 화면 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('IDLE — 헤더·시작 안내가 영어', () => {
    useLocViewModel.mockReturnValue({
      viewState: stateWith({ assessmentState: 'IDLE' }),
      actions,
      touchButtonRef: { current: null },
    });
    const { container } = render(<LocScreen />);
    expect(
      screen.getByText('Level of consciousness (LOC) assessment'),
    ).toBeInTheDocument();
    expect(container.textContent).toContain('Patient:');
    expect(container.textContent).toContain('Jane');
    expect(screen.getByText('Ready to start?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start assessment' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('AWAITING_TOUCH — 터치 안내·타이머가 영어', () => {
    useLocViewModel.mockReturnValue({
      viewState: stateWith({ assessmentState: 'AWAITING_TOUCH', remainingSeconds: 6 }),
      actions,
      touchButtonRef: { current: null },
    });
    const { container } = render(<LocScreen />);
    expect(screen.getByText('Touch the screen now')).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: '6 seconds remaining' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('TRIAL_INTERRUPTED — 재개 안내가 영어', () => {
    useLocViewModel.mockReturnValue({
      viewState: stateWith({ assessmentState: 'TRIAL_INTERRUPTED' }),
      actions,
      touchButtonRef: { current: null },
    });
    const { container } = render(<LocScreen />);
    expect(screen.getByText('We paused for a moment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('ASSESSMENT_COMPLETE — 완료·시도별 결과·다음 버튼이 영어', () => {
    useLocViewModel.mockReturnValue({
      viewState: stateWith({
        assessmentState: 'ASSESSMENT_COMPLETE',
        finalScore: 2,
        trialResults: [
          {
            trialNumber: 1,
            latencyMs: 1200,
            touchInBounds: true,
            score: 1,
            scoreLabel: '경도 지연',
            isComplete: true,
          },
        ],
      }),
      actions,
      touchButtonRef: { current: null },
    });
    const { container } = render(<LocScreen />);
    expect(screen.getByText('Assessment complete')).toBeInTheDocument();
    expect(screen.getByText('Final score')).toBeInTheDocument();
    expect(screen.getByText('Results by trial')).toBeInTheDocument();
    expect(screen.getByText('Trial 1')).toBeInTheDocument();
    expect(screen.getByText('1 pts')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to next assessment' }),
    ).toBeInTheDocument();
    // scoreLabel은 도메인(LocScorer.ts)이 만드는 한글이라 검사에서 뺀다.
    expect(container.textContent).toContain('경도 지연');
  });
});
