/**
 * AssessmentCard 단위 테스트
 *
 * Feature Plan 섹션 7-4 기반:
 * - 미완료 상태 렌더링
 * - 완료 상태 렌더링
 * - onStart 콜백 호출
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AssessmentCard } from './AssessmentCard.js';

describe('AssessmentCard', () => {
  const 기본_props = {
    title: '문장 이해',
    subtitle: 'QAB 하위검사 4번',
    description: '복잡한 구문 이해력 평가',
    onStart: vi.fn(),
  };

  describe('케이스 1: isCompleted=false 상태 렌더링', () => {
    it('"시작하기" 버튼이 렌더링된다', () => {
      // Arrange
      render(<AssessmentCard {...기본_props} isCompleted={false} />);

      // Assert
      expect(screen.getByRole('button', { name: '시작하기' })).toBeInTheDocument();
    });

    it('"완료" 뱃지가 렌더링되지 않는다', () => {
      // Arrange
      render(<AssessmentCard {...기본_props} isCompleted={false} />);

      // Assert
      // 버튼 텍스트 "시작하기"는 존재하지만, span 뱃지 "완료"는 없어야 한다
      const completedBadge = screen.queryByText('완료');
      expect(completedBadge).not.toBeInTheDocument();
    });
  });

  describe('케이스 2: isCompleted=true 상태 렌더링', () => {
    it('"완료" 뱃지가 렌더링된다', () => {
      // Arrange
      render(<AssessmentCard {...기본_props} isCompleted={true} />);

      // Assert
      // "완료"가 여러 번 나타날 수 있으므로 (뱃지 + 버튼) getAllByText 사용
      const completedTexts = screen.getAllByText('완료');
      expect(completedTexts.length).toBeGreaterThanOrEqual(1);
      // span 뱃지(rounded-full 클래스 포함)가 존재해야 한다
      const badge = completedTexts.find((el) => el.tagName === 'SPAN');
      expect(badge).toBeInTheDocument();
    });

    it('버튼 텍스트가 "완료"로 표시된다', () => {
      // Arrange
      render(<AssessmentCard {...기본_props} isCompleted={true} />);

      // Assert
      expect(screen.getByRole('button', { name: '완료' })).toBeInTheDocument();
    });
  });

  describe('케이스 3: onStart 콜백 호출', () => {
    it('isCompleted=false 상태에서 "시작하기" 버튼 클릭 시 onStart가 1회 호출된다', () => {
      // Arrange
      const mockOnStart = vi.fn();
      render(<AssessmentCard {...기본_props} isCompleted={false} onStart={mockOnStart} />);

      // Act
      fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

      // Assert
      expect(mockOnStart).toHaveBeenCalledTimes(1);
    });
  });
});
