import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WeeklyReportScreen } from './WeeklyReportScreen.js';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type { QabTrendSeries } from '../../patient/quiz/domain/QabResult.js';

vi.mock('../../shared/AuthContext.js', () => ({
  useAuth: () => ({ user: { patientDisplayName: '박순자' } }),
}));

/**
 * 검사 기록 상세 회귀 테스트.
 *
 * 두 가지가 반드시 지켜져야 한다:
 *  1. 문항 수가 함께 보일 것 — "정답률 50%"만 보면 n=10인지 알 수 없다
 *  2. 한계 고지가 실릴 것 — 가정 자가 측정이고 진단이 아니다
 *
 * 인쇄 기능은 의도적으로 없다. 종이에 찍힌 표는 검사 결과지처럼 보여서,
 * 이 데이터가 실제로 가진 신뢰도보다 과하게 읽힌다.
 */
describe('WeeklyReportScreen', () => {
  function makeTrend(): QabTrendSeries[] {
    return [
      {
        subtest: 'sentence',
        points: [
          { weekStart: '2026-07-06', total: 10, correct: 4, accuracy: 40, avgScore: null, avgMetric: null },
          { weekStart: '2026-07-13', total: 10, correct: 7, accuracy: 70, avgScore: null, avgMetric: null },
        ],
        deltaFromPrevious: 30,
      },
      {
        subtest: 'loc',
        points: [
          { weekStart: '2026-07-13', total: 3, correct: 1, accuracy: 33, avgScore: 1, avgMetric: null },
        ],
        deltaFromPrevious: null,
      },
      {
        subtest: 'repeat',
        points: [
          { weekStart: '2026-07-13', total: 8, correct: 5, accuracy: 63, avgScore: 82, avgMetric: null },
        ],
        deltaFromPrevious: null,
      },
      {
        subtest: 'ddk',
        points: [
          { weekStart: '2026-07-13', total: 4, correct: 3, accuracy: 75, avgScore: null, avgMetric: 18.5 },
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
    // 정답률 검사가 여럿(문장·따라말하기)이라 복수로 존재한다.
    expect(screen.getAllByText('정답률').length).toBeGreaterThan(0);
  });

  it('ddk는 정답률이 아니라 감지 횟수를, 발화는 발음 점수를 보여준다', async () => {
    // ddk의 핵심 지표는 감지 횟수(metric)다. 정답률만 보면 말 움직임의
    // 빠르기를 알 수 없다. 발화(따라말하기·읽기)는 발음 점수가 핵심이다.
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(makeTrend());

    render(<WeeklyReportScreen onBack={vi.fn()} />);

    // ddk: 평균 감지 열과 그 값(18.5)
    await waitFor(() => expect(screen.getByText('평균 감지(회)')).toBeTruthy());
    expect(screen.getByText('18.5')).toBeTruthy();
    // ddk는 '통과율'로 표기(정답률이 아님)
    expect(screen.getByText('통과율')).toBeTruthy();
    // 발화: 발음 열과 그 값(82)
    expect(screen.getByText('발음(0~100)')).toBeTruthy();
    expect(screen.getByText('82')).toBeTruthy();
  });

  it('인쇄 기능을 노출하지 않는다', async () => {
    // 의도적인 부재다. 가정 자가 측정 기록이라 진료 문서로 내밀 만한
    // 공신력이 없고, 종이에 찍히면 검사 결과지처럼 과하게 읽힌다.
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue(makeTrend());

    render(<WeeklyReportScreen onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('70%')).toBeTruthy());
    expect(screen.queryByText(/인쇄/)).toBeNull();
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
