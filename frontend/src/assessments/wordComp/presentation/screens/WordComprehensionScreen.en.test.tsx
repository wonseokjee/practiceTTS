// 단어 이해(WordComp) 검사 메인 화면을 영어로 그린다(영어판 Phase 1-2)
//
// ViewModel(useWordComprehensionViewModel)은 실제 인프라(오디오·리포지토리·
// 유스케이스)를 구성 루트에서 직접 만들어 phase별로 가볍게 렌더 테스트하기
// 어렵다. SessionContext와 함께 훅 자체를 모킹해 각 phase의 문구만 본다.
//
// 검증 포인트: 활성 로케일이 en-US면 phase별 문구가 영어로 나오고 한글이
// 새지 않는다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import { WordComprehensionScreen } from './WordComprehensionScreen.js';
import type {
  WordCompViewActions,
  WordCompViewState,
} from '../hooks/useWordComprehensionViewModel.js';
import type { WordCompPhase } from '../wordCompSessionReducer.js';

const useSessionContext = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/session/SessionContext.js', () => ({
  useSessionContext: () => useSessionContext(),
}));

const useWordComprehensionViewModel = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useWordComprehensionViewModel.js', () => ({
  useWordComprehensionViewModel: (...args: unknown[]) =>
    useWordComprehensionViewModel(...args),
}));

const HANGUL = /[가-힣]/;

const actions: WordCompViewActions = {
  onChoiceSelected: vi.fn(),
  onReplayRequested: vi.fn(),
  onRetry: vi.fn(),
};

function stateWith(phase: WordCompPhase, over?: Partial<WordCompViewState>): WordCompViewState {
  return {
    phase,
    currentItemIndex: 0,
    totalItems: 6,
    currentItem: null,
    isSelectable: false,
    isAudioPlaying: false,
    replayCount: 0,
    summary: null,
    errorMessage: null,
    ...over,
  };
}

describe('단어 이해 검사 메인 화면 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('세션 없음 — 안내가 영어', () => {
    useSessionContext.mockReturnValue({ session: null, endSession: vi.fn() });
    const { container } = render(<WordComprehensionScreen />);
    expect(
      screen.getByText('No session info found. Please restart the assessment.'),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('LOADING — 로딩 문구가 영어', () => {
    useSessionContext.mockReturnValue({
      session: { patientId: 'p1', patientName: 'Jane' },
      endSession: vi.fn(),
    });
    useWordComprehensionViewModel.mockReturnValue({
      viewState: stateWith({ type: 'LOADING' }),
      actions,
    });
    const { container } = render(<WordComprehensionScreen />);
    expect(screen.getByText('Loading item...')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('ERROR — 오류·재시도 버튼이 영어', () => {
    useSessionContext.mockReturnValue({
      session: { patientId: 'p1', patientName: 'Jane' },
      endSession: vi.fn(),
    });
    useWordComprehensionViewModel.mockReturnValue({
      viewState: stateWith({ type: 'ERROR', message: 'oops' }),
      actions,
    });
    const { container } = render(<WordComprehensionScreen />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('COMPLETED(집계 중) — 헤더·집계 문구가 영어', () => {
    useSessionContext.mockReturnValue({
      session: { patientId: 'p1', patientName: 'Jane' },
      endSession: vi.fn(),
    });
    useWordComprehensionViewModel.mockReturnValue({
      viewState: stateWith({ type: 'COMPLETED' }, { summary: null }),
      actions,
    });
    const { container } = render(<WordComprehensionScreen />);
    expect(screen.getByText('Word comprehension assessment')).toBeInTheDocument();
    expect(screen.getByText('Assessment complete')).toBeInTheDocument();
    expect(screen.getByText('Patient: Jane')).toBeInTheDocument();
    expect(screen.getByText('Tallying results...')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('TRANSITIONING — 헤더·전환 문구가 영어', () => {
    useSessionContext.mockReturnValue({
      session: { patientId: 'p1', patientName: 'Jane' },
      endSession: vi.fn(),
    });
    useWordComprehensionViewModel.mockReturnValue({
      viewState: stateWith({ type: 'TRANSITIONING' }),
      actions,
    });
    const { container } = render(<WordComprehensionScreen />);
    // 헤더 문구가 &nbsp;·&nbsp;로 나뉜 두 t() 호출 사이에 걸쳐 있어
    // 텍스트 노드가 갈린다 — 문단 전체 텍스트로 확인한다.
    expect(container.textContent).toContain('QAB subtest 3');
    expect(container.textContent).toContain('Patient: Jane');
    expect(screen.getByText('Moving to the next item...')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'End assessment session' }),
    ).toHaveTextContent('End session');
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
