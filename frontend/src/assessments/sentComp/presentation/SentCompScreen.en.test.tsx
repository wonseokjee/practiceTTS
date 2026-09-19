// 문장 이해(SentComp) 검사 메인 화면을 영어로 그린다(영어판 Phase 1-2)
//
// useSentCompViewModel은 오디오·리포지토리·유스케이스를 실제로 조립하는
// 무거운 훅이라, 전체 FSM을 통과시키는 렌더 테스트 대신 훅 자체를
// 모킹해 phase별 문구만 확인한다(LocScreen·WordComprehensionScreen
// 배치와 같은 방식).
//
// 검증 포인트: 활성 로케일이 en-US면 phase별 문구가 영어로 나오고
// 한글이 새지 않는다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { SentCompScreen } from './SentCompScreen.js';
import type { SentCompActions, SentCompViewState } from './useSentCompViewModel.js';
import type { SessionPhase } from './sentCompSessionReducer.js';
import type { SentenceComprehensionItem } from '../domain/types.js';

vi.mock('../../../shared/session/SessionContext.js', () => ({
  useSessionContext: () => ({
    session: { sessionId: 's1', patientId: 'p1', patientName: 'Jane' },
    endSession: vi.fn(),
  }),
}));

const useSentCompViewModel = vi.hoisted(() => vi.fn());
vi.mock('./useSentCompViewModel.js', () => ({
  useSentCompViewModel: (...args: unknown[]) => useSentCompViewModel(...args),
}));

const actions: SentCompActions = {
  handleImageSelect: vi.fn(),
  handleReplay: vi.fn(),
  handleFeedbackDone: vi.fn(),
  handleRetry: vi.fn(),
};

const item: SentenceComprehensionItem = {
  itemId: 'i1',
  sentence: 'The dog is chasing the cat.',
  sentenceAudioUrl: '/a.mp3',
  sentenceType: 'reversible',
  choices: [
    { imageUrl: '/a.png', altText: 'dog chasing cat', isCorrect: true },
    { imageUrl: '/b.png', altText: 'cat chasing dog', isCorrect: false },
  ],
  orderIndex: 0,
};

function stateWith(phase: SessionPhase, over?: Partial<SentCompViewState>): SentCompViewState {
  return {
    phase,
    currentItem: null,
    currentItemIndex: 0,
    totalItems: 6,
    submittedResults: [],
    score: null,
    errorMessage: null,
    selectedIndex: null,
    ...over,
  };
}

const HANGUL = /[가-힣]/;

describe('문장 이해 검사 메인 화면 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('LOADING — 헤더·로딩 문구가 영어', () => {
    useSentCompViewModel.mockReturnValue({
      viewState: stateWith({ type: 'LOADING' }),
      actions,
    });
    const { container } = render(<SentCompScreen />);
    expect(
      screen.getByText('Sentence comprehension (SentComp) assessment'),
    ).toBeInTheDocument();
    expect(container.textContent).toContain('Patient:');
    expect(container.textContent).toContain('Jane');
    expect(screen.getByText('Loading item…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('ERROR — 오류·재시도 버튼이 영어', () => {
    useSentCompViewModel.mockReturnValue({
      viewState: stateWith({ type: 'ERROR', message: 'oops' }),
      actions,
    });
    const { container } = render(<SentCompScreen />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('FEEDBACK(정답) — 정답 피드백이 영어', () => {
    useSentCompViewModel.mockReturnValue({
      viewState: stateWith(
        { type: 'FEEDBACK', isCorrect: true, isLastItem: false },
        { currentItem: item, selectedIndex: 0 },
      ),
      actions,
    });
    render(<SentCompScreen />);
    expect(screen.getByText('Correct!')).toBeInTheDocument();
  });

  it('FEEDBACK(오답) — 오답 피드백이 영어', () => {
    useSentCompViewModel.mockReturnValue({
      viewState: stateWith(
        { type: 'FEEDBACK', isCorrect: false, isLastItem: false },
        { currentItem: item, selectedIndex: 1 },
      ),
      actions,
    });
    render(<SentCompScreen />);
    expect(screen.getByText('Incorrect.')).toBeInTheDocument();
  });

  it('COMPLETED(채점 중) — 집계 문구가 영어', () => {
    useSentCompViewModel.mockReturnValue({
      viewState: stateWith({ type: 'COMPLETED' }, { score: null }),
      actions,
    });
    const { container } = render(<SentCompScreen />);
    expect(screen.getByText('Scoring…')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
