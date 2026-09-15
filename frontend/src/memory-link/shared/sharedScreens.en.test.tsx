// 로그인·온보딩 등 공용 화면을 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.
//
// honorific.ts·QabOutbox.ts 등 이 디렉터리의 나머지 파일은 이 배치의 범위가
// 아니다 — extraction.test.ts의 EXTRACTED_FILES 설명 참고.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { i18n } from '../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../shared/domain/locale.js';

const HANGUL = /[가-힣]/;

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

const loginMock = vi.fn();
const registerMock = vi.fn();
const loginWithCodeMock = vi.fn();
const refreshUserMock = vi.fn();
vi.mock('./AuthContext.js', () => ({
  useAuth: () => ({
    login: loginMock,
    register: registerMock,
    loginWithCode: loginWithCodeMock,
    refreshUser: refreshUserMock,
    user: { displayName: 'Jane' },
  }),
}));

const postMock = vi.fn();
vi.mock('./MemoryLinkApi.js', async () => {
  const actual =
    await vi.importActual<typeof import('./MemoryLinkApi.js')>('./MemoryLinkApi.js');
  return {
    ...actual,
    memoryLinkApi: { post: (...args: unknown[]) => postMock(...args) },
  };
});

import { LoginScreen } from './LoginScreen.js';
import { OnboardingScreen } from './OnboardingScreen.js';
import { ReturnToCaregiverPinModal } from './ReturnToCaregiverPinModal.js';
import { SocialCallbackScreen } from './SocialCallbackScreen.js';
import { DailyHealingBanner } from './components/DailyHealingBanner.js';

describe('공용 화면(로그인·온보딩 등) — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });
  beforeEach(() => {
    navigate.mockReset();
    loginMock.mockReset();
    registerMock.mockReset();
    loginWithCodeMock.mockReset();
    refreshUserMock.mockReset();
    postMock.mockReset();
    window.history.pushState({}, '', '/login');
  });

  it('로그인 화면 — 탭·라벨·소셜 버튼이 영어', () => {
    const { container } = render(<LoginScreen />);
    expect(
      screen.getByText('Cognitive training and memory connection platform'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Log in' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Sign up' }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Continue with Kakao/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Continue with Google/ }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('회원가입 폼 — 빈 이메일 제출 시 오류 문구가 영어', () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    const submit = screen
      .getAllByRole('button', { name: 'Sign up' })
      .find((b) => b.getAttribute('type') === 'submit');
    fireEvent.click(submit as HTMLElement);
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your email.');
  });

  it('온보딩 화면 — 인사말·안내·필드 라벨이 영어', () => {
    const { container } = render(<OnboardingScreen />);
    expect(screen.getByText('Welcome, Jane')).toBeInTheDocument();
    expect(
      screen.getByText("Before we start, tell us about the person you're caring for."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByLabelText("Loved one's name")).toBeInTheDocument();
    expect(
      screen.getByText('Already signed up another way?'),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('보호자 복귀 PIN 모달 — 제목·라벨·버튼이 영어', () => {
    const { container } = render(
      <ReturnToCaregiverPinModal
        isOpen
        onCancel={() => {}}
        onVerify={() => Promise.resolve(false)}
      />,
    );
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByLabelText('Caregiver PIN, 4 digits')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('소셜 콜백 실패 — 안내·버튼이 영어', async () => {
    const { container } = render(<SocialCallbackScreen />);
    expect(
      await screen.findByText('Login failed. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to login' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('치유 메시지 배너 — 라벨이 영어', async () => {
    const api = { fetchToday: vi.fn(async () => ({ id: 'm1', text: 'Stay strong.' })) };
    const { container } = render(<DailyHealingBanner api={api} />);
    expect(await screen.findByText("Today's message")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
