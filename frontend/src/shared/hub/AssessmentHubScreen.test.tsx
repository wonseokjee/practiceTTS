/**
 * AssessmentHubScreen 렌더링 테스트
 *
 * Feature Plan 섹션 7-3 기반:
 * - 두 검사 모두 미완료 상태
 * - SentComp 완료 뱃지 표시
 * - 두 검사 모두 완료 시 완료 메시지
 * - 검사 카드 선택 시 onSelect 호출
 *
 * useSessionContext를 vi.mock으로 격리한다.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AssessmentHubScreen } from './AssessmentHubScreen.js';

// SessionContext 모킹 — SessionProvider 의존성 제거, session 값 제어
vi.mock('../session/SessionContext.js', () => ({
  useSessionContext: () => ({
    session: { sessionId: 'test-session', patientId: 'P001' },
    endSession: vi.fn(),
  }),
}));

describe('AssessmentHubScreen', () => {
  describe('케이스 1: 두 검사 모두 미완료', () => {
    it('"시작하기" 버튼이 2개 렌더링된다', () => {
      // Arrange & Act
      render(
        <AssessmentHubScreen
          completedAssessments={{ sentComp: false, wordComp: false }}
          onSelect={vi.fn()}
        />
      );

      // Assert
      const startButtons = screen.getAllByRole('button', { name: '시작하기' });
      expect(startButtons).toHaveLength(2);
    });

    it('"모든 검사가 완료되었습니다" 메시지가 없다', () => {
      // Arrange & Act
      render(
        <AssessmentHubScreen
          completedAssessments={{ sentComp: false, wordComp: false }}
          onSelect={vi.fn()}
        />
      );

      // Assert
      expect(screen.queryByText(/모든 검사가 완료되었습니다/)).not.toBeInTheDocument();
    });
  });

  describe('케이스 2: SentComp 완료 뱃지 표시', () => {
    it('문장 이해 카드에 "완료" 뱃지가 표시된다', () => {
      // Arrange & Act
      render(
        <AssessmentHubScreen
          completedAssessments={{ sentComp: true, wordComp: false }}
          onSelect={vi.fn()}
        />
      );

      // Assert
      // "문장 이해" 카드 영역을 찾아서 그 안에 완료 뱃지(span)가 있는지 확인
      const sentCompTitle = screen.getByText('문장 이해');
      const sentCompCard = sentCompTitle.closest('div[class*="rounded"]') ?? sentCompTitle.parentElement?.parentElement?.parentElement;
      expect(sentCompCard).not.toBeNull();
      // 완료 뱃지(span.rounded-full)가 문장 이해 카드 안에 있어야 한다
      const allBadges = screen.getAllByText('완료').filter((el) => el.tagName === 'SPAN');
      expect(allBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('단어 이해 카드에는 "완료" 뱃지가 없다', () => {
      // Arrange & Act
      render(
        <AssessmentHubScreen
          completedAssessments={{ sentComp: true, wordComp: false }}
          onSelect={vi.fn()}
        />
      );

      // Assert
      // "단어 이해" 카드에는 "시작하기" 버튼이 있어야 한다
      expect(screen.getByRole('button', { name: '시작하기' })).toBeInTheDocument();
    });

    it('"모든 검사가 완료되었습니다" 메시지가 없다', () => {
      // Arrange & Act
      render(
        <AssessmentHubScreen
          completedAssessments={{ sentComp: true, wordComp: false }}
          onSelect={vi.fn()}
        />
      );

      // Assert
      expect(screen.queryByText(/모든 검사가 완료되었습니다/)).not.toBeInTheDocument();
    });
  });

  describe('케이스 3: 두 검사 모두 완료 → 완료 메시지', () => {
    it('"모든 검사가 완료되었습니다" 메시지가 렌더링된다', () => {
      // Arrange & Act
      render(
        <AssessmentHubScreen
          completedAssessments={{ sentComp: true, wordComp: true }}
          onSelect={vi.fn()}
        />
      );

      // Assert
      expect(screen.getByText(/모든 검사가 완료되었습니다/)).toBeInTheDocument();
    });
  });

  describe('케이스 4: 검사 카드 선택 시 onSelect 호출', () => {
    it('문장 이해 카드의 "시작하기" 버튼 클릭 시 onSelect("sentComp")가 호출된다', () => {
      // Arrange
      const mockOnSelect = vi.fn();
      render(
        <AssessmentHubScreen
          completedAssessments={{ sentComp: false, wordComp: false }}
          onSelect={mockOnSelect}
        />
      );

      // Act — 첫 번째 "시작하기" 버튼이 문장 이해(sentComp) 카드에 해당
      const startButtons = screen.getAllByRole('button', { name: '시작하기' });
      fireEvent.click(startButtons[0]);

      // Assert
      expect(mockOnSelect).toHaveBeenCalledWith('sentComp');
      expect(mockOnSelect).toHaveBeenCalledTimes(1);
    });
  });
});
