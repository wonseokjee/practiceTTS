// QabProgressCard.tsx — 보호자 QAB 회복 추세 카드 테스트

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QabProgressCard } from './QabProgressCard.js';
import type { QabSubtestSummary } from '../../patient/quiz/domain/QabResult.js';

function summary(overrides?: Partial<QabSubtestSummary>): QabSubtestSummary {
  return {
    subtest: 'word',
    total: 4,
    correct: 3,
    accuracy: 75,
    assisted: 0,
    avgMetric: null,
    maxMetric: null,
    lastAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('QabProgressCard', () => {
  it('데이터가 있으면 검사별 정답률을 표시한다', async () => {
    const fetchSummary = vi.fn().mockResolvedValue([summary()]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText(/3\/4/)).toBeInTheDocument();
  });

  it('ddk는 최고 횟수를 함께 표시한다', async () => {
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([
        summary({ subtest: 'ddk', accuracy: 50, correct: 1, total: 2, maxMetric: 11 }),
      ]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('말운동(퍼터커)')).toBeInTheDocument(),
    );
    expect(screen.getByText(/최고 11회/)).toBeInTheDocument();
  });

  it('보호자 도움(assisted)이 있으면 "도움 N회"를 표시한다', async () => {
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([summary({ assisted: 2 })]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);
    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );
    expect(screen.getByText(/도움 2회/)).toBeInTheDocument();
  });

  it('직접 응답 없이 도움만 있으면 정답률 막대 대신 안내를 표시한다', async () => {
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([
        summary({ total: 0, correct: 0, accuracy: 0, assisted: 3 }),
      ]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);
    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );
    expect(screen.getByText(/아직 직접 푼 기록 없음/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('데이터가 없으면 아무것도 렌더하지 않는다', async () => {
    const fetchSummary = vi.fn().mockResolvedValue([]);
    const { container } = render(
      <QabProgressCard fetchSummary={fetchSummary} />,
    );
    await waitFor(() => expect(fetchSummary).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('조회 실패 시에도 카드를 숨긴다(대시보드 방해 안 함)', async () => {
    const fetchSummary = vi.fn().mockRejectedValue(new Error('boom'));
    const { container } = render(
      <QabProgressCard fetchSummary={fetchSummary} />,
    );
    await waitFor(() => expect(fetchSummary).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
