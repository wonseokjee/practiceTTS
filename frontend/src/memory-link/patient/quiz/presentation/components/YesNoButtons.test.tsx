// YesNoButtons.tsx — 예/아니오 버튼 테스트
//
// 검증 포인트:
//  - "예" 클릭 → onSelect('yes'), "아니오" 클릭 → onSelect('no')
//  - 선택 불가 시 비활성화
//  - 피드백 + 정답 sage + ✓, 오답 선택 terracotta + ✗

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YesNoButtons } from './YesNoButtons.js';

interface Overrides {
  isSelectable?: boolean;
  selectedAnswer?: string | null;
  showFeedback?: boolean;
  correctAnswer?: string | null;
}

function renderButtons(overrides?: Overrides) {
  const onSelect = vi.fn();
  render(
    <YesNoButtons
      isSelectable={overrides?.isSelectable ?? true}
      selectedAnswer={overrides?.selectedAnswer ?? null}
      showFeedback={overrides?.showFeedback ?? false}
      correctAnswer={overrides?.correctAnswer ?? null}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

describe('YesNoButtons', () => {
  it('"예" 클릭 시 onSelect("yes")가 호출된다', () => {
    const { onSelect } = renderButtons();
    fireEvent.click(screen.getByRole('button', { name: '예' }));
    expect(onSelect).toHaveBeenCalledWith('yes');
  });

  it('"아니오" 클릭 시 onSelect("no")가 호출된다', () => {
    const { onSelect } = renderButtons();
    fireEvent.click(screen.getByRole('button', { name: '아니오' }));
    expect(onSelect).toHaveBeenCalledWith('no');
  });

  it('선택 불가 시 두 버튼 모두 비활성화된다', () => {
    renderButtons({ isSelectable: false });
    expect(screen.getByRole('button', { name: '예' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '아니오' })).toBeDisabled();
  });

  it('피드백 단계에서 정답 버튼은 sage 색상과 ✓를 보인다', () => {
    renderButtons({
      showFeedback: true,
      correctAnswer: 'yes',
      selectedAnswer: 'yes',
    });
    const yesBtn = screen.getByRole('button', { name: '예' });
    expect(yesBtn.className).toContain('border-primary');
    expect(yesBtn.className).toContain('bg-primary-light');
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('피드백 단계에서 고른 오답 버튼은 terracotta 색상과 ✗를 보인다', () => {
    // 정답은 yes인데 no를 골랐다.
    renderButtons({
      showFeedback: true,
      correctAnswer: 'yes',
      selectedAnswer: 'no',
    });
    const noBtn = screen.getByRole('button', { name: '아니오' });
    expect(noBtn.className).toContain('border-accent');
    expect(noBtn.className).toContain('bg-accent-soft');
    expect(screen.getByText('✗')).toBeInTheDocument();
  });
});
