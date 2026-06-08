// CaregiverWishCard 단위 테스트 (Phase 6 Pattern 1)
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CaregiverWishCard } from './CaregiverWishCard.js';
import type { WishPractice } from '../domain/Quiz.js';

const PRACTICE: WishPractice = {
  echoSentence: '오늘도 사랑해 우리 손녀',
  fillBlank: { prompt: '오늘도 사랑해 우리 ___', answer: '손녀', hintFirstChar: '손' },
  model: 'gemini-2.5-flash-lite',
  fallbackUsed: false,
};

describe('CaregiverWishCard', () => {
  it('한마디 본문을 표시한다 (기본 따라말하기 탭에 원문)', () => {
    render(
      <CaregiverWishCard
        quizSetId="set-1"
        wishMessage="오늘도 사랑해 우리 손녀"
        onProceed={vi.fn()}
        fetchPractice={vi.fn()}
      />,
    );
    expect(
      screen.getAllByText('오늘도 사랑해 우리 손녀').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('따라말하기 탭은 LLM 호출(fetchPractice) 없이 표시된다', () => {
    const fetchPractice = vi.fn();
    render(
      <CaregiverWishCard
        quizSetId="set-1"
        wishMessage="사랑해"
        onProceed={vi.fn()}
        fetchPractice={fetchPractice}
      />,
    );
    expect(fetchPractice).not.toHaveBeenCalled();
  });

  it('빈칸 탭 전환 시 변환을 가져와 빈칸/힌트 표시, 정답 보기로 정답 노출', async () => {
    const fetchPractice = vi.fn(async () => PRACTICE);
    render(
      <CaregiverWishCard
        quizSetId="set-1"
        wishMessage="오늘도 사랑해 우리 손녀"
        onProceed={vi.fn()}
        fetchPractice={fetchPractice}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '빈칸 채우기' }));

    await waitFor(() => {
      expect(screen.getByText('오늘도 사랑해 우리 ___')).toBeInTheDocument();
    });
    expect(fetchPractice).toHaveBeenCalledWith('set-1');
    expect(screen.getByText(/첫 글자는/)).toBeInTheDocument();

    expect(screen.queryByText('정답: 손녀')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('정답 보기'));
    expect(screen.getByText('정답: 손녀')).toBeInTheDocument();
  });

  it('빈칸 변환 실패 시 에러 + 다시 시도 노출', async () => {
    const fetchPractice = vi.fn(async () => {
      throw new Error('502');
    });
    render(
      <CaregiverWishCard
        quizSetId="set-1"
        wishMessage="사랑해 손녀"
        onProceed={vi.fn()}
        fetchPractice={fetchPractice}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '빈칸 채우기' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('다시 시도')).toBeInTheDocument();
  });

  it('"퀴즈 풀러 가기" 클릭 시 onProceed 호출', () => {
    const onProceed = vi.fn();
    render(
      <CaregiverWishCard
        quizSetId="set-1"
        wishMessage="사랑해"
        onProceed={onProceed}
        fetchPractice={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '퀴즈 풀이로 이동' }));
    expect(onProceed).toHaveBeenCalledOnce();
  });
});
