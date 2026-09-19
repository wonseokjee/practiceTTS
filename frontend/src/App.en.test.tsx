// App.tsx 루트 라우트 가드·검사 준비 문구를 영어로 그린다(영어판 Phase 1-2)
//
// App.test.tsx와 달리 AuthContext.useAuth를 시나리오별로 갈아끼워야 해서
// 별도 파일로 뒀다. react-router-dom을 App.test.tsx와 같은 방식으로 모킹해
// (Route가 path와 무관하게 element를 전부 마운트) 모든 라우트 가드가 동시에
// 렌더된다 — 그래서 CaregiverDashboard·PatientDashboard도 가벼운 스텁으로
// 모킹해 실제 무거운 트리를 안 그린다.
//
// 검증 포인트: 활성 로케일이 en-US면 라우트 가드 문구(로딩·보호자 전용
// 접근 거부)와 검사 준비 문구가 영어로 나온다.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from './shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from './shared/domain/locale.js';

vi.mock('./assessments/loc/presentation/LocScreen.js', () => ({
  LocScreen: () => <div data-testid="loc-screen" />,
}));
vi.mock('./assessments/sentComp/presentation/SentCompScreen.js', () => ({
  SentCompScreen: () => <div data-testid="sentcomp-screen" />,
}));
vi.mock('./assessments/wordComp/presentation/screens/WordComprehensionScreen.js', () => ({
  WordComprehensionScreen: () => <div data-testid="wordcomp-screen" />,
}));
vi.mock('./shared/hub/AssessmentHubScreen.js', () => ({
  AssessmentHubScreen: () => <div data-testid="hub-screen" />,
}));
vi.mock('./shared/session/PatientSetupScreen.js', () => ({
  PatientSetupScreen: () => <div data-testid="patient-setup-screen" />,
}));
vi.mock('./memory-link/shared/LoginScreen.js', () => ({
  LoginScreen: () => <div data-testid="login-screen" />,
}));
vi.mock('./memory-link/shared/SocialCallbackScreen.js', () => ({
  SocialCallbackScreen: () => <div data-testid="social-callback-screen" />,
}));
vi.mock('./memory-link/shared/OnboardingScreen.js', () => ({
  OnboardingScreen: () => <div data-testid="onboarding-screen" />,
}));
vi.mock('./memory-link/shared/LocaleSync.js', () => ({
  LocaleSync: () => null,
}));
vi.mock('./memory-link/caregiver/presentation/CaregiverDashboard.js', () => ({
  CaregiverDashboard: () => <div data-testid="caregiver-dashboard" />,
}));
vi.mock('./memory-link/patient/presentation/PatientDashboard.js', () => ({
  PatientDashboard: () => <div data-testid="patient-dashboard" />,
}));

const mockSession: { session: { sessionId: string; patientId: string } | null } = {
  session: null,
};
vi.mock('./shared/session/SessionContext.js', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSessionContext: () => ({
    session: mockSession.session,
    startSession: vi.fn(),
    endSession: vi.fn(),
  }),
}));

const useAuth = vi.hoisted(() => vi.fn());
vi.mock('./memory-link/shared/AuthContext.js', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => useAuth(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Route: ({ element }: { path?: string; element: React.ReactNode }) => <>{element}</>,
    Navigate: () => null,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(''), vi.fn()],
  };
});

import App from './App.js';

const HANGUL = /[가-힣]/;

describe('App 라우트 가드 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('인증 로딩 중 — 라우트 가드마다 로딩 문구가 영어', () => {
    useAuth.mockReturnValue({ user: null, isLoading: true, isPatientMode: false });
    const { container } = render(<App />);
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('환자 역할로 보호자 라우트 접근 — 접근 거부 문구가 영어', () => {
    useAuth.mockReturnValue({
      user: { role: 'patient', id: 'u1', needsOnboarding: false },
      isLoading: false,
      isPatientMode: false,
    });
    const { container } = render(<App />);
    expect(
      screen.getByText('Only caregiver accounts can access this.'),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('보호자 로그인, 세션 미생성 — 검사 준비 문구가 영어', () => {
    useAuth.mockReturnValue({
      user: {
        role: 'caregiver',
        id: 'u1',
        patientId: 'p1',
        needsOnboarding: false,
      },
      isLoading: false,
      isPatientMode: false,
    });
    mockSession.session = null;
    const { container } = render(<App />);
    expect(screen.getByText("Getting the assessment ready…")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
