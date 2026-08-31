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
    unscored: 0,
    avgMetric: null,
    maxMetric: null,
    avgScore: null,
    lastAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('QabProgressCard — 단서량 (E18)', () => {
  // 정답률이 못 말하는 것을 말하는 줄이다. 이름대기는 도움이 직접 푼 것보다
  // 많아서 정답률 분모가 거의 비는데, 그 도움 자체가 여기서는 측정값이다.

  it('평균 단서 단계와 표본 수를 보여준다', async () => {
    const fetchSummary = vi.fn().mockResolvedValue([
      summary({
        subtest: 'naming',
        total: 1,
        correct: 1,
        accuracy: 100,
        assisted: 7,
        avgCueLevel: 2.4,
        cueScored: 8,
      }),
    ]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('2.4단계')).toBeInTheDocument(),
    );
    expect(screen.getByText(/8문항/)).toBeInTheDocument();
  });

  it('막대는 스스로 한 만큼을 채운다 — 도움이 줄면 자란다', async () => {
    // 0단계(늘 스스로)면 가득, 4단계(늘 알려줌)면 비어야 한다. 거꾸로 그리면
    // 도움이 많을수록 좋아 보인다.
    const render단계 = async (avgCueLevel: number) => {
      const { container, unmount } = render(
        <QabProgressCard
          fetchSummary={vi.fn().mockResolvedValue([
            summary({ subtest: 'naming', avgCueLevel, cueScored: 5 }),
          ])}
        />,
      );
      await waitFor(() =>
        expect(screen.getByText(`${avgCueLevel}단계`)).toBeInTheDocument(),
      );
      const bar = container.querySelector<HTMLElement>(
        '[aria-label*="단계 도움"] > div',
      );
      const width = bar!.style.width;
      unmount();
      return width;
    };

    expect(await render단계(0)).toBe('100%');
    expect(await render단계(4)).toBe('0%');
  });

  it('표본이 없으면 줄 자체를 안 그린다', async () => {
    // avgCueLevel이 null이면 이 기능 이전의 기록뿐이라는 뜻이다. 0으로
    // 그리면 "늘 스스로 맞혔다"는 없는 사실이 된다.
    const fetchSummary = vi.fn().mockResolvedValue([
      summary({ subtest: 'naming', avgCueLevel: null, cueScored: 0 }),
    ]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('그림 이름대기')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/단계 도움/)).toBeNull();
  });
});

describe('QabProgressCard', () => {
  it('채점하지 못한 문항 수를 함께 보여준다', async () => {
    // 분모에서 뺐으므로 (3/4)와 "몇 번 했나"가 어긋난다. 그 어긋남을 설명하지
    // 않으면 보호자는 기록이 빠진 줄 안다. 채점 실패가 이어져도 아무도 모른다.
    const fetchSummary = vi.fn().mockResolvedValue([summary({ unscored: 2 })]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText(/못 잰 2회/)).toBeInTheDocument(),
    );
  });

  it('채점하지 못한 문항이 없으면 그 표기는 나오지 않는다', async () => {
    const fetchSummary = vi.fn().mockResolvedValue([summary()]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/못 잰/)).not.toBeInTheDocument();
  });

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

  it('도움이 직접 푼 것보다 많으면 정답률 대신 센 것을 말한다', async () => {
    // 실제로 그림 이름대기가 `정답률 100% (1/1) · 도움 7회`로 떴다. 8번 제시 중
    // 7번이 보호자 넘어가기인데 100%가 굵게 먼저 읽힌다.
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([
        summary({ total: 1, correct: 1, accuracy: 100, assisted: 7 }),
      ]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);
    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );

    // 카드 설명문에도 '정답률'이 있으므로, 실제로 안 나와야 하는 것(굵은 100%)을 본다.
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByText(/직접 푼/)).toBeInTheDocument();
    expect(screen.getByText(/1개 정답/)).toBeInTheDocument();
    expect(screen.getByText(/도움/)).toBeInTheDocument();
  });

  it('그때는 막대를 그리지 않는다 — 1문항짜리가 28문항짜리보다 길어 보인다', async () => {
    // 막대는 길이로만 말하고 표본 크기를 담지 못한다. 1/1이 가득 차고 7/28이
    // 1/4이면, 28번 푼 검사가 1번 푼 검사보다 나빠 보인다.
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([
        summary({ total: 1, correct: 1, accuracy: 100, assisted: 7 }),
      ]);
    const { container } = render(
      <QabProgressCard fetchSummary={fetchSummary} />,
    );
    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );

    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  });

  it('도움이 있어도 직접 푼 것이 더 많으면 정답률을 그대로 보여준다', async () => {
    // 도움이 조금 섞였다고 비율을 감추면, 대부분 직접 푼 검사의 신호까지 잃는다.
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([
        summary({ total: 28, correct: 7, accuracy: 25, assisted: 2 }),
      ]);
    const { container } = render(
      <QabProgressCard fetchSummary={fetchSummary} />,
    );
    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );

    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
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

describe('새 검사 노출', () => {
  it('글자 조합이 한글 라벨로 표시된다', async () => {
    // 2026-08-17: spell 추가 시 이 라벨 맵을 빠뜨려 영문 'spell'이 그대로 떴다.
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([summary({ subtest: 'spell' })]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('글자 조합')).toBeInTheDocument(),
    );
    expect(screen.queryByText('spell')).toBeNull();
  });

  it('표시 순서에 없는 검사가 목록 맨 앞으로 튀지 않는다', async () => {
    // SUBTEST_ORDER에 없으면 indexOf가 -1이라 정렬이 맨 앞으로 보낸다.
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([summary({ subtest: 'spell' }), summary()]);
    const { container } = render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );
    const text = container.textContent ?? '';
    expect(text.indexOf('단어 이해')).toBeLessThan(text.indexOf('글자 조합'));
  });
});

describe('반복 훈련 과제 구분 표시', () => {
  it('글자 조합에는 반복 연습 배지와 연습 정답률 문구가 붙는다', async () => {
    // 반복 훈련의 정답률 상승은 회복이 아니라 문항 친숙도다. 같은 숫자를 같은
    // 자리에 같은 모양으로 놓으면 보호자가 회복 신호로 오독한다.
    const fetchSummary = vi
      .fn()
      .mockResolvedValue([summary({ subtest: 'spell' })]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('글자 조합')).toBeInTheDocument(),
    );
    expect(screen.getByText('반복 연습')).toBeInTheDocument();
    expect(screen.getByText(/연습 정답률/)).toBeInTheDocument();
  });

  it('다른 검사에는 반복 연습 배지를 붙이지 않는다', async () => {
    // 매번 다른 문항이라 정답률이 회복 신호로 읽힌다.
    const fetchSummary = vi.fn().mockResolvedValue([summary()]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);

    await waitFor(() =>
      expect(screen.getByText('단어 이해')).toBeInTheDocument(),
    );
    expect(screen.queryByText('반복 연습')).toBeNull();
  });

  /**
   * **정답률이 못 하는 말을 한다.**
   *
   * "정답률 24%"는 몇 개 틀렸는지까지다. 무엇이 어려운지는 어떤 오답을 골랐는가가
   * 말한다. 다만 표본이 적을 때 말하면 우연을 손상으로 읽게 되므로, 말할 수 없을
   * 때는 아무 말도 안 한다.
   */
  describe('오답 갈래 한 줄', () => {
    const kinds = (semantic: number, phonological: number, unrelated = 0) => ({
      foilKinds: { semantic, phonological, unrelated },
    });

    it('표본이 충분하면 갈래별 개수를 말한다', async () => {
      const fetchSummary = vi
        .fn()
        .mockResolvedValue([summary({ total: 20, correct: 12, accuracy: 60, ...kinds(5, 3) })]);
      render(<QabProgressCard fetchSummary={fetchSummary} />);

      await waitFor(() =>
        expect(screen.getByText(/뜻이 가까운 그림 5개/)).toBeInTheDocument(),
      );
      expect(screen.getByText(/소리가 닮은 그림 3개/)).toBeInTheDocument();
      expect(screen.getByText(/고른 오답 8개 중/)).toBeInTheDocument();
    });

    it('표본이 적으면 아무 말도 하지 않는다', async () => {
      // 두세 개로 "소리에서 어려워한다"고 말하면 우연을 손상으로 읽는 것이다.
      const fetchSummary = vi
        .fn()
        .mockResolvedValue([summary(kinds(2, 1))]);
      render(<QabProgressCard fetchSummary={fetchSummary} />);

      await waitFor(() =>
        expect(screen.getByText('단어 이해')).toBeInTheDocument(),
      );
      expect(screen.queryByText(/뜻이 가까운 그림/)).toBeNull();
    });

    it('무관 오답은 분모에 넣지 않는다', async () => {
      // 어느 축의 어려움도 가리키지 않는다. 넣으면 분모만 키워 두 갈래의 대비를
      // 흐린다.
      const fetchSummary = vi
        .fn()
        .mockResolvedValue([summary(kinds(4, 2, 30))]);
      render(<QabProgressCard fetchSummary={fetchSummary} />);

      await waitFor(() =>
        expect(screen.getByText(/고른 오답 6개 중/)).toBeInTheDocument(),
      );
    });

    it('갈래 기록이 없으면 줄 자체가 없다', async () => {
      // 컬럼 이전의 옛 행만 있는 환자, 단어 이해가 아닌 하위검사.
      const fetchSummary = vi.fn().mockResolvedValue([summary()]);
      render(<QabProgressCard fetchSummary={fetchSummary} />);

      await waitFor(() =>
        expect(screen.getByText('단어 이해')).toBeInTheDocument(),
      );
      expect(screen.queryByText(/고른 오답/)).toBeNull();
    });

    it('0을 안전하게 읽지 않도록 안내를 단다', async () => {
      // 소리가 닮은 그림은 눈높이 4단계부터 나온다. 그 아래 환자의 0은
      // "소리는 괜찮다"가 아니라 "아직 안 물어봤다"이다.
      const fetchSummary = vi
        .fn()
        .mockResolvedValue([summary(kinds(7, 0))]);
      render(<QabProgressCard fetchSummary={fetchSummary} />);

      const line = await screen.findByText(/고른 오답 7개 중/);
      expect(line).toHaveAttribute(
        'title',
        expect.stringContaining('눈높이 4단계부터'),
      );
    });
  });
});

