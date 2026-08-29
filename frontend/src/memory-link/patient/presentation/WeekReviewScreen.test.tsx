import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WeekReviewScreen } from './WeekReviewScreen.js';
import type { WeekReviewItem } from '../quiz/domain/Quiz.js';

const 사진기억: WeekReviewItem = {
  quizSetId: 'q1',
  memoryEntryId: 'm1',
  photoUrl: 'uploads/memory-images/sea.jpg',
  notes: [],
  lastPlayedAt: '2026-08-26T02:00:00.000Z',
};

const 글기억: WeekReviewItem = {
  quizSetId: 'q2',
  memoryEntryId: 'm2',
  photoUrl: null,
  notes: [
    { category: 'activity' as const, text: '바다' },
    { category: 'moment' as const, text: '바다에 갔어요.' },
    { category: 'context' as const, text: '회를 먹었어요.' },
  ],
  lastPlayedAt: '2026-08-25T02:00:00.000Z',
};

function 렌더(items: WeekReviewItem[]) {
  const onBack = vi.fn();
  const view = render(
    <WeekReviewScreen onBack={onBack} loadItems={() => Promise.resolve(items)} />,
  );
  return { onBack, ...view };
}

describe('WeekReviewScreen', () => {
  it('그 순간은 본문으로, 짧은 답변은 태그로 조판한다', async () => {
    const { container } = 렌더([글기억]);
    await waitFor(() =>
      expect(screen.getByText('바다에 갔어요.')).toBeInTheDocument(),
    );
    // moment만 본문 문단이다.
    const 본문 = [...container.querySelectorAll('p')].map((e) => e.textContent);
    expect(본문).toContain('바다에 갔어요.');
    expect(본문).not.toContain('바다');
    // activity·context는 칩 목록으로 간다.
    const 칩 = [...container.querySelectorAll('ul li ul li')].map(
      (e) => e.textContent,
    );
    expect(칩).toEqual(['바다', '회를 먹었어요.']);
  });

  /**
   * 사진 자리 = `AuthedImage`가 차지하는 칸.
   *
   * 이 컴포넌트는 토큰을 실어 fetch한 뒤 Blob URL로 바꾼다. 로드 전에는 같은
   * className의 빈 div를 남겨 레이아웃을 유지하므로, jsdom에서는 `<img>`가 아니라
   * 그 칸을 봐야 한다. `fallback`을 안 넘겼으니 그 칸은 비어 있다 — 아이콘도
   * 회색 상자도 없다.
   */
  const 사진자리 = (c: HTMLElement) =>
    c.querySelectorAll('[class*="aspect-"]');

  it('사진이 있는 기억은 사진 자리를 만든다', async () => {
    const { container } = 렌더([사진기억]);
    await waitFor(() => expect(사진자리(container)).toHaveLength(1));
  });

  it('사진이 없는 기억은 글로 보여주고, 빈 사진 자리를 만들지 않는다', async () => {
    // 회색 상자 + 아이콘을 두면 "사진이 빠진 카드"로 읽힌다. 글만 있는 기억은
    // 결핍이 아니라 다른 종류의 기억이다.
    const { container } = 렌더([글기억]);
    await waitFor(() =>
      expect(screen.getByText('바다에 갔어요.')).toBeInTheDocument(),
    );
    // moment는 본문, 나머지는 태그 칩. 셋을 같은 크기로 늘어놓으면 한두 낱말짜리
    // 답변('바다')이 문장 조각처럼 읽힌다.
    expect(screen.getByText('바다')).toBeInTheDocument();
    expect(screen.getByText('회를 먹었어요.')).toBeInTheDocument();
    expect(사진자리(container)).toHaveLength(0);
  });

  it('두 종류가 섞여도 각자의 조판으로 나온다', async () => {
    const { container } = 렌더([사진기억, 글기억]);
    await waitFor(() =>
      expect(screen.getByText('바다에 갔어요.')).toBeInTheDocument(),
    );
    expect(사진자리(container)).toHaveLength(1);
    // 태그 칩도 li라서 전체를 세면 안 된다 — 카드 목록의 직계 자식만 센다.
    const 카드목록 = container.querySelector('ul');
    expect(카드목록?.children).toHaveLength(2);
  });

  it('점수를 어디에도 표시하지 않는다', async () => {
    // 환자 화면은 정답률을 보여주지 않는 것이 이 앱의 원칙이다. 돌아보기는
    // 평가가 아니라 회상이다.
    const { container } = 렌더([사진기억, 글기억]);
    await waitFor(() =>
      expect(screen.getByText('바다에 갔어요.')).toBeInTheDocument(),
    );
    expect(container.textContent).not.toMatch(/점|정답률|%/);
  });

  it('푼 기억이 없으면 "연습을 안 했다"고 말한다 — "기억이 없다"가 아니라', async () => {
    // 둘을 같은 문구로 묶으면, 보호자가 기억을 넣어뒀는데도 없다고 읽힌다.
    렌더([]);
    await waitFor(() =>
      expect(screen.getByText('요즘 연습한 기억이 아직 없어요.')).toBeInTheDocument(),
    );
    expect(screen.getByText('오늘 연습을 하면 여기에 모여요.')).toBeInTheDocument();
  });

  it('조회에 실패해도 화면이 깨지지 않는다', async () => {
    const onBack = vi.fn();
    render(
      <WeekReviewScreen
        onBack={onBack}
        loadItems={() => Promise.reject(new Error('network'))}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        '기억을 불러오지 못했어요.',
      ),
    );
    expect(screen.getByRole('button', { name: '돌아가기' })).toBeInTheDocument();
  });

  it('돌아가기 버튼이 44px 이상이다', async () => {
    렌더([]);
    const back = await screen.findByRole('button', { name: '돌아가기' });
    expect(back.className).toMatch(/min-h-\[44px\]/);
  });
});
