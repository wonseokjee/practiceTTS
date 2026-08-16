import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionCompletionCard } from './SessionCompletionCard.js';
import type { SessionStats } from '../../patient/quiz/domain/QabResult.js';

const makeStats = (over: Partial<SessionStats> = {}): SessionStats => ({
  started: 10,
  completed: 7,
  completionRate: 70,
  avgItemsBeforeDropoff: 4.3,
  ...over,
});

describe('SessionCompletionCard', () => {
  it('완료율과 시작/완료 횟수를 보여준다', async () => {
    render(
      <SessionCompletionCard fetchStats={() => Promise.resolve(makeStats())} />,
    );

    expect(await screen.findByText('70%')).toBeInTheDocument();
    expect(
      screen.getByText(/시작 10회 중 7회\s*완료/),
    ).toBeInTheDocument();
  });

  it('이탈 지점을 문항 수로 보여준다', async () => {
    render(
      <SessionCompletionCard fetchStats={() => Promise.resolve(makeStats())} />,
    );

    expect(await screen.findByText('4.3문항')).toBeInTheDocument();
  });

  it('이탈이 없으면 이탈 지점 문구를 감춘다', async () => {
    render(
      <SessionCompletionCard
        fetchStats={() =>
          Promise.resolve(
            makeStats({
              started: 5,
              completed: 5,
              completionRate: 100,
              avgItemsBeforeDropoff: null,
            }),
          )
        }
      />,
    );

    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.queryByText(/중간에 그만둔 연습은 평균/)).toBeNull();
  });

  it('연습 기록이 없으면 카드를 숨긴다', async () => {
    // 0%를 띄우면 시작도 안 한 보호자에게 실패한 것처럼 보인다.
    const { container } = render(
      <SessionCompletionCard
        fetchStats={() =>
          Promise.resolve({
            started: 0,
            completed: 0,
            completionRate: null,
            avgItemsBeforeDropoff: null,
          })
        }
      />,
    );

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('조회에 실패해도 대시보드를 깨뜨리지 않는다', async () => {
    const { container } = render(
      <SessionCompletionCard
        fetchStats={() => Promise.reject(new Error('network'))}
      />,
    );

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('스트릭과 기준이 다르다는 점을 밝힌다', async () => {
    // 같은 앱 안에서 '연습한 날'과 완료율이 어긋나 보이면 보호자가 어느 쪽을
    // 믿을지 몰라 한다.
    render(
      <SessionCompletionCard fetchStats={() => Promise.resolve(makeStats())} />,
    );

    expect(
      await screen.findByText(/한 문항이라도 푼 날을 세요/),
    ).toBeInTheDocument();
  });

  it('fetchStats 미주입이면 quizApi를 30일 기준으로 호출한다', async () => {
    const { quizApi } = await import(
      '../../patient/quiz/infrastructure/QuizApi.js'
    );
    const spy = vi
      .spyOn(quizApi, 'getSessionStats')
      .mockResolvedValue(makeStats());

    render(<SessionCompletionCard />);

    await waitFor(() => expect(spy).toHaveBeenCalledWith(30));
    spy.mockRestore();
  });
});
