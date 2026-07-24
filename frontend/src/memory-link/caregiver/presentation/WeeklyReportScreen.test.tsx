import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WeeklyReportScreen } from './WeeklyReportScreen.js';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type { QabTrendSeries } from '../../patient/quiz/domain/QabResult.js';

vi.mock('../../shared/AuthContext.js', () => ({
  useAuth: () => ({ user: { patientDisplayName: '박순자' } }),
}));

/**
 * 진료용 리포트 회귀 테스트.
 *
 * 이 화면은 병원에 들고 가는 물건이다. 두 가지가 반드시 지켜져야 한다:
 *  1. 문항 수가 함께 보일 것 — "정답률 50%"만 보면 의료진이 오독한다(n=10일 수 있다)
 *  2. 한계 고지가 실릴 것 — 자가 측정이고 진단이 아니다
 */
describe('WeeklyReportScreen', () => {
  function makeTrend(): QabTrendSeries[] {
    return [
      {
        subtest: 'sentence',
        points: [
          { weekStart: '2026-07-06', total: 10, correct: 4, accuracy: 40, avgScore: null },
          { weekStart: '2026-07-13', total: 10, correct: 7, accuracy: 70, avgScore: null },
        ],
        deltaFromPrevious: 30,
      },
      {
        subtest: 'loc',
        points: [
          { weekStart: '2026-07-13', total: 3, correct: 1, accuracy: 33, avgScore: 1 },
        ],
        deltaFromPrevious: null,
      },
    ];
  }

  it('주차별 정답률과 문항 수를 함께 보여준다', async () => {
    // 문항 수 없이 정답률만 보면 n=3인지 n=100인지 알 수 없다.
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(makeTrend());

    render(<WeeklyReportScreen onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('70%')).toBeTruthy());
    // 분자·분모가 표에 함께 있다
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getByText(/총 \d+문항/)).toBeTruthy();
  });

  it('한계 고지를 반드시 싣는다', async () => {
    // 이게 빠지면 자가 측정 기록이 표준화 검사처럼 읽힌다.
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(makeTrend());

    render(<WeeklyReportScreen onBack={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/의료 진단이나 표준화 검사 결과가 아닙니다/)).toBeTruthy(),
    );
    expect(screen.getByText(/주간 변동이 큽니다/)).toBeTruthy();
  });

  it('loc는 반응률로, 나머지는 정답률로 표기한다', async () => {
    // loc는 정답·오답이 아니다. 같은 말로 쓰면 오독한다.
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(makeTrend());

    render(<WeeklyReportScreen onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('반응률')).toBeTruthy());
    expect(screen.getByText('정답률')).toBeTruthy();
  });

  it('조작 버튼에 인쇄 제외 표시가 붙어 있다', async () => {
    // 종이에 "인쇄하기" 버튼이 찍히면 안 된다.
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(makeTrend());

    const { container } = render(<WeeklyReportScreen onBack={vi.fn()} />);

    const controls = container.querySelector('.no-print');
    expect(controls).toBeTruthy();
    expect(controls?.textContent).toContain('인쇄하기');
  });

  it('기록이 없으면 무엇을 하면 되는지 알려준다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue([]);

    render(<WeeklyReportScreen onBack={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/아직 검사 기록이 없습니다/)).toBeTruthy(),
    );
  });

  it('불러오기에 실패해도 화면이 깨지지 않는다', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockRejectedValue(new Error('network'));

    render(<WeeklyReportScreen onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
