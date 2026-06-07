// MultipleChoiceCard.tsx — 4지선다 보기 카드 테스트
//
// 검증 포인트 (Plan §4):
//  - 선택 가능 시 클릭하면 onSelect(보기)
//  - 선택 불가(disabled) 시 클릭 무시
//  - 피드백 + 정답: sage 색(#2D6A56/#EBF4F0) + ✓
//  - 피드백 + 오답 선택: terracotta 색(#E07B54/#FBE9E2) + ✗
//
// jsdom은 computed style 미지원이므로 className 문자열/아이콘으로 검증한다.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultipleChoiceCard } from './MultipleChoiceCard.js';

interface Overrides {
  isSelectable?: boolean;
  isSelected?: boolean;
  showFeedback?: boolean;
  isCorrectAnswer?: boolean;
}

function renderCard(overrides?: Overrides) {
  const onSelect = vi.fn();
  render(
    <MultipleChoiceCard
      choice="공원"
      isSelectable={overrides?.isSelectable ?? true}
      isSelected={overrides?.isSelected ?? false}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrectAnswer={overrides?.isCorrectAnswer ?? false}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

describe('MultipleChoiceCard', () => {
  it('선택 가능 시 클릭하면 onSelect가 보기 텍스트로 호출된다', () => {
    const { onSelect } = renderCard({ isSelectable: true });
    fireEvent.click(screen.getByRole('button', { name: '공원' }));
    expect(onSelect).toHaveBeenCalledWith('공원');
  });

  it('선택 불가(disabled) 시 버튼이 비활성화된다', () => {
    renderCard({ isSelectable: false });
    expect(screen.getByRole('button', { name: '공원' })).toBeDisabled();
  });

  it('피드백 단계에서 정답이면 sage 색상 클래스와 ✓ 아이콘을 보인다', () => {
    renderCard({ showFeedback: true, isCorrectAnswer: true });
    const btn = screen.getByRole('button', { name: '공원' });
    expect(btn.className).toContain('border-[#2D6A56]');
    expect(btn.className).toContain('bg-[#EBF4F0]');
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('피드백 단계에서 오답을 골랐으면 terracotta 색상과 ✗ 아이콘을 보인다', () => {
    renderCard({
      showFeedback: true,
      isCorrectAnswer: false,
      isSelected: true,
    });
    const btn = screen.getByRole('button', { name: '공원' });
    expect(btn.className).toContain('border-[#E07B54]');
    expect(btn.className).toContain('bg-[#FBE9E2]');
    expect(screen.getByText('✗')).toBeInTheDocument();
  });

  it('선택 상태는 aria-pressed로 반영된다', () => {
    renderCard({ isSelected: true });
    expect(screen.getByRole('button', { name: '공원' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
