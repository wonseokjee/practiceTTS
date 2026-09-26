// QabProgressCard.tsx / WeeklyReportScreen.tsx — 채점 방식이 바뀐 지점 안내(계획 PR 5b)
//
// 이웃 비교 채점을 켜면 정답 처리 규칙이 바뀌어 전환 시점에 정답률이 내려간다. 환자가 나빠진 것이 아니라
// 자가 바뀐 것이라, 보호자에게 바뀐 날짜를 알리고 전환을 사이에 둔 ▲▼ 변화는 숨긴다.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QabProgressCard } from './QabProgressCard.js';
import { WeeklyReportScreen } from './WeeklyReportScreen.js';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type {
  QabSubtestSummary,
  QabTrendSeries,
} from '../../patient/quiz/domain/QabResult.js';

vi.mock('../../shared/AuthContext.js', () => ({
  useAuth: () => ({ user: { patientDisplayName: '박순자' } }),
}));

function summary(overrides?: Partial<QabSubtestSummary>): QabSubtestSummary {
  return {
    subtest: 'naming',
    total: 20,
    correct: 12,
    accuracy: 60,
    assisted: 0,
    unscored: 0,
    avgMetric: null,
    maxMetric: null,
    avgScore: null,
    lastAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

const point = (weekStart: string, accuracy: number) => ({
  weekStart,
  total: 10,
  correct: Math.round(accuracy / 10),
  accuracy,
  avgScore: null,
  avgMetric: null,
});

/** 세 주: 70 → 70 → 50 (마지막 두 주의 차이 = -20%p) */
function trend(subtest = 'naming'): QabTrendSeries[] {
  return [
    {
      subtest,
      points: [point('2026-09-07', 70), point('2026-09-14', 70), point('2026-09-21', 50)],
      deltaFromPrevious: -20,
    },
  ];
}

const CHANGED_NOTE = /채점 방식이 바뀌었어요/;
const SWITCHED = {
  scorerVersions: ['azure-pa-nbr-v1', 'azure-pa-v1'],
  scorerChangedAt: '2026-09-23T01:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QabProgressCard — 채점 방식이 바뀐 지점', () => {
  it('바뀐 검사에 날짜와 함께 안내한다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue([]);
    render(<QabProgressCard fetchSummary={vi.fn().mockResolvedValue([summary(SWITCHED)])} />);
    const note = await screen.findByText(CHANGED_NOTE);
    expect(note).toHaveTextContent('2026년 9월 23일');
    expect(note).toHaveTextContent('바로 비교하기 어려워요');
  });

  it('바뀐 적이 없는 검사에는 안내가 없다 — 옛 서버·버전 하나·전환 시각 없음', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue([]);
    const items = [
      summary({ subtest: 'naming' }), // 옛 서버: 필드 없음
      summary({ subtest: 'repeat', scorerVersions: ['azure-pa-nbr-v1'], scorerChangedAt: '2026-09-23T01:00:00.000Z' }),
      summary({ subtest: 'reading', scorerVersions: ['azure-pa-v1'], scorerChangedAt: null }),
    ];
    render(<QabProgressCard fetchSummary={vi.fn().mockResolvedValue(items)} />);
    await screen.findByText(/이름대기|이름 대기/);
    expect(screen.queryByText(CHANGED_NOTE)).not.toBeInTheDocument();
  });

  it('바뀐 검사에만 붙는다 — 다른 검사에는 안 붙는다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue([]);
    const items = [summary({ subtest: 'naming', ...SWITCHED }), summary({ subtest: 'repeat' })];
    render(<QabProgressCard fetchSummary={vi.fn().mockResolvedValue(items)} />);
    await screen.findByText(CHANGED_NOTE);
    expect(screen.getAllByText(CHANGED_NOTE)).toHaveLength(1);
  });

  it('전환을 사이에 둔 두 주의 ▲▼는 숨긴다 — 자의 변화를 악화로 읽지 않게', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(trend());
    render(<QabProgressCard fetchSummary={vi.fn().mockResolvedValue([summary(SWITCHED)])} />);
    await screen.findByText(CHANGED_NOTE);
    // 스파크라인(실제 주간 수치)은 그대로 있다
    await waitFor(() => expect(screen.getByRole('img', { name: /70, 70, 50/ })).toBeInTheDocument());
    expect(screen.queryByText(/%p/)).not.toBeInTheDocument();
  });

  it('두 주가 모두 전환 뒤면 ▲▼를 보여준다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(trend());
    const early = { ...SWITCHED, scorerChangedAt: '2026-09-02T00:00:00.000Z' };
    render(<QabProgressCard fetchSummary={vi.fn().mockResolvedValue([summary(early)])} />);
    await screen.findByText(CHANGED_NOTE);
    expect(await screen.findByText(/▼20%p/)).toBeInTheDocument();
  });

  it('전환이 없으면 ▲▼를 예전처럼 보여준다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(trend());
    render(<QabProgressCard fetchSummary={vi.fn().mockResolvedValue([summary()])} />);
    expect(await screen.findByText(/▼20%p/)).toBeInTheDocument();
    expect(screen.queryByText(CHANGED_NOTE)).not.toBeInTheDocument();
  });
});

describe('WeeklyReportScreen — 채점 방식이 바뀐 지점', () => {
  it('바뀐 검사의 표 위에 안내한다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(trend());
    render(
      <WeeklyReportScreen
        onBack={vi.fn()}
        fetchSummary={vi.fn().mockResolvedValue([summary(SWITCHED)])}
      />,
    );
    expect(await screen.findByText(CHANGED_NOTE)).toHaveTextContent('2026년 9월 23일');
  });

  it('요약을 못 가져와도 표는 그대로 보인다 — 안내가 부가 정보다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(trend());
    render(
      <WeeklyReportScreen
        onBack={vi.fn()}
        fetchSummary={vi.fn().mockRejectedValue(new Error('offline'))}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByText('70%', { selector: 'td' }).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(CHANGED_NOTE)).not.toBeInTheDocument();
  });

  it('바뀐 적이 없으면 안내가 없다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(trend());
    render(
      <WeeklyReportScreen onBack={vi.fn()} fetchSummary={vi.fn().mockResolvedValue([summary()])} />,
    );
    await waitFor(() => expect(screen.getAllByText('70%', { selector: 'td' }).length).toBeGreaterThan(0));
    expect(screen.queryByText(CHANGED_NOTE)).not.toBeInTheDocument();
  });
});
