/**
 * App.tsx 상태 전환 테스트
 *
 * Feature Plan 섹션 7-2 기반:
 * - LOC → 허브 전환
 * - SentComp 완료 후 허브 복귀
 * - WordComp 완료 후 허브 복귀
 * - 허브 → 검사 선택
 * - 세션 없음 → PatientSetupScreen
 *
 * 내부 TTS/UseCase/API 의존성을 모두 vi.mock으로 격리한다.
 * AssessmentContent를 직접 테스트하여 라우터 의존성을 제거한다.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScoreDTO } from './assessments/sentComp/application/dtos.js';
import type { SessionSummaryDTO } from './assessments/wordComp/application/dtos/SessionSummaryDTO.js';

// ---- 화면 컴포넌트 Mock ----
vi.mock('./assessments/loc/presentation/LocScreen.js', () => ({
  LocScreen: ({ onComplete, onProceed }: { onComplete?: (id: string) => void; onProceed?: () => void }) => (
    <div data-testid="loc-screen">
      <button onClick={() => onComplete?.('result-1')}>loc-complete</button>
      <button onClick={() => onProceed?.()}>loc-proceed</button>
    </div>
  ),
}));

vi.mock('./assessments/sentComp/presentation/SentCompScreen.js', () => ({
  SentCompScreen: ({ onComplete }: { onComplete?: (score: ScoreDTO) => void }) => {
    const mockScore: ScoreDTO = {
      totalScore: 10,
      correctCount: 5,
      totalItems: 10,
      byType: {},
      averageReactionTimeMs: 1500,
      averageReplayCount: 0,
    };
    return (
      <div data-testid="sentcomp-screen">
        <button onClick={() => onComplete?.(mockScore)}>sentcomp-complete</button>
      </div>
    );
  },
}));

vi.mock('./assessments/wordComp/presentation/screens/WordComprehensionScreen.js', () => ({
  WordComprehensionScreen: ({ onComplete }: { onComplete?: (summary: SessionSummaryDTO) => void }) => {
    const mockSummary: SessionSummaryDTO = {
      totalScore: 15,
      percentageScore: 75,
      totalItems: 20,
      distractorPattern: {
        semanticErrorCount: 1,
        phonemicErrorCount: 1,
        unrelatedErrorCount: 1,
        semanticErrorRate: 0.2,
        phonemicErrorRate: 0.2,
        unrelatedErrorRate: 0.2,
      },
      averageReactionTimeMs: 2000,
      averageReplayCount: 0,
    };
    return (
      <div data-testid="wordcomp-screen">
        <button onClick={() => onComplete?.(mockSummary)}>wordcomp-complete</button>
      </div>
    );
  },
}));

vi.mock('./shared/hub/AssessmentHubScreen.js', () => ({
  AssessmentHubScreen: ({
    completedAssessments,
    onSelect,
  }: {
    completedAssessments: { sentComp: boolean; wordComp: boolean };
    onSelect: (id: string) => void;
  }) => (
    <div data-testid="hub-screen">
      <span data-testid="sentcomp-completed">{String(completedAssessments.sentComp)}</span>
      <span data-testid="wordcomp-completed">{String(completedAssessments.wordComp)}</span>
      <button onClick={() => onSelect('sentComp')}>hub-select-sentcomp</button>
      <button onClick={() => onSelect('wordComp')}>hub-select-wordcomp</button>
    </div>
  ),
}));

// ---- SessionContext Mock ----
// session이 있는 기본 상태 제공. 케이스별로 필요 시 재정의.
const mockSession: { session: { sessionId: string; patientId: string } | null } = {
  session: { sessionId: 'test-session', patientId: 'P001' },
};

vi.mock('./shared/session/SessionContext.js', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSessionContext: () => ({
    session: mockSession.session,
    startSession: vi.fn(),
    endSession: vi.fn(),
  }),
}));

// ---- PatientSetupScreen Mock ----
vi.mock('./shared/session/PatientSetupScreen.js', () => ({
  PatientSetupScreen: () => (
    <div data-testid="patient-setup-screen">
      <h1>practiveTTS</h1>
    </div>
  ),
}));

// ---- AuthContext Mock: 항상 로딩 완료, 미인증 상태로 고정 ----
// AssessmentContent는 인증과 무관하게 동작하므로 AuthProvider를 패스스루로 모킹
vi.mock('./memory-link/shared/AuthContext.js', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: null,
    token: null,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

// ---- 라우터 관련 모듈 Mock ----
// App이 BrowserRouter를 포함하므로 react-router-dom을 모킹하여
// AssessmentWrapper가 항상 렌더링되도록 한다
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Route: ({ element }: { path?: string; element: React.ReactNode }) => <>{element}</>,
    Navigate: () => null,
    useNavigate: () => vi.fn(),
  };
});

// App 컴포넌트는 mock 설정 이후에 import
import App from './App.js';

describe('App 상태 전환 테스트', () => {
  beforeEach(() => {
    // 각 테스트 전 session을 기본 값(있음)으로 초기화
    mockSession.session = { sessionId: 'test-session', patientId: 'P001' };
  });

  describe('케이스 1: LOC → 허브 전환', () => {
    it('session 존재, 초기 appPhase="LOC" → LocScreen 렌더링', () => {
      // Arrange & Act
      render(<App />);

      // Assert
      expect(screen.getByTestId('loc-screen')).toBeInTheDocument();
    });

    it('loc-proceed 버튼 클릭 → AssessmentHubScreen 렌더링', () => {
      // Arrange
      render(<App />);

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'loc-proceed' }));

      // Assert
      expect(screen.getByTestId('hub-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('loc-screen')).not.toBeInTheDocument();
    });
  });

  describe('케이스 2: SentComp 완료 후 허브 복귀', () => {
    it('HUB phase에서 onSelect("sentComp") → SentCompScreen 렌더링', () => {
      // Arrange
      render(<App />);
      // LOC → HUB
      fireEvent.click(screen.getByRole('button', { name: 'loc-proceed' }));

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'hub-select-sentcomp' }));

      // Assert
      expect(screen.getByTestId('sentcomp-screen')).toBeInTheDocument();
    });

    it('SentComp onComplete 콜백 → HUB로 복귀하고 sentComp 완료 상태가 true가 된다', () => {
      // Arrange
      render(<App />);
      // LOC → HUB → SENT_COMP
      fireEvent.click(screen.getByRole('button', { name: 'loc-proceed' }));
      fireEvent.click(screen.getByRole('button', { name: 'hub-select-sentcomp' }));

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'sentcomp-complete' }));

      // Assert — 허브로 복귀
      expect(screen.getByTestId('hub-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('sentcomp-screen')).not.toBeInTheDocument();
      // completedAssessments.sentComp === true
      expect(screen.getByTestId('sentcomp-completed').textContent).toBe('true');
    });
  });

  describe('케이스 3: WordComp 완료 후 허브 복귀', () => {
    it('HUB phase에서 onSelect("wordComp") → WordComprehensionScreen 렌더링', () => {
      // Arrange
      render(<App />);
      // LOC → HUB
      fireEvent.click(screen.getByRole('button', { name: 'loc-proceed' }));

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'hub-select-wordcomp' }));

      // Assert
      expect(screen.getByTestId('wordcomp-screen')).toBeInTheDocument();
    });

    it('WordComp onComplete 콜백 → HUB로 복귀하고 wordComp 완료 상태가 true가 된다', () => {
      // Arrange
      render(<App />);
      // LOC → HUB → WORD_COMP
      fireEvent.click(screen.getByRole('button', { name: 'loc-proceed' }));
      fireEvent.click(screen.getByRole('button', { name: 'hub-select-wordcomp' }));

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'wordcomp-complete' }));

      // Assert — 허브로 복귀
      expect(screen.getByTestId('hub-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('wordcomp-screen')).not.toBeInTheDocument();
      // completedAssessments.wordComp === true
      expect(screen.getByTestId('wordcomp-completed').textContent).toBe('true');
    });
  });

  describe('케이스 4: 허브 → 검사 선택', () => {
    it('HUB phase에서 onSelect("sentComp") → SENT_COMP phase로 전환된다', () => {
      // Arrange
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'loc-proceed' }));

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'hub-select-sentcomp' }));

      // Assert
      expect(screen.getByTestId('sentcomp-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('hub-screen')).not.toBeInTheDocument();
    });

    it('HUB phase에서 onSelect("wordComp") → WORD_COMP phase로 전환된다', () => {
      // Arrange
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'loc-proceed' }));

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'hub-select-wordcomp' }));

      // Assert
      expect(screen.getByTestId('wordcomp-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('hub-screen')).not.toBeInTheDocument();
    });
  });

  describe('케이스 5: 세션 없음 → PatientSetupScreen', () => {
    it('session=null이면 PatientSetupScreen이 렌더링된다', () => {
      // Arrange — session을 null로 설정
      mockSession.session = null;

      // Act
      render(<App />);

      // Assert — PatientSetupScreen의 특징적인 텍스트 확인
      expect(screen.getByText('practiveTTS')).toBeInTheDocument();
    });

    it('session=null이면 LocScreen이 렌더링되지 않는다', () => {
      // Arrange
      mockSession.session = null;

      // Act
      render(<App />);

      // Assert
      expect(screen.queryByTestId('loc-screen')).not.toBeInTheDocument();
    });
  });
});
