// LoginScreen 소셜 로그인 — "최근 사용" 배지

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ML_LAST_PROVIDER_KEY } from './MemoryLinkApi.js';

vi.mock('./AuthContext.js', () => ({
  useAuth: () => ({ login: vi.fn(), register: vi.fn() }),
}));

import { LoginScreen } from './LoginScreen.js';

describe('LoginScreen 소셜 로그인 버튼', () => {
  beforeEach(() => localStorage.clear());

  it('카카오·구글 버튼이 모두 있다', () => {
    render(<LoginScreen />);
    expect(
      screen.getByRole('button', { name: /카카오로 시작하기/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Google로 시작하기/ }),
    ).toBeTruthy();
  });

  it('직전 사용 제공자에만 "최근 사용" 배지가 붙는다', () => {
    localStorage.setItem(ML_LAST_PROVIDER_KEY, 'google');
    render(<LoginScreen />);

    const badge = screen.getByText('최근 사용');
    const googleBtn = screen.getByRole('button', { name: /Google로 시작하기/ });
    const kakaoBtn = screen.getByRole('button', { name: /카카오로 시작하기/ });
    // 배지는 구글 버튼 안에, 카카오 버튼 안에는 없다
    expect(googleBtn.contains(badge)).toBe(true);
    expect(kakaoBtn.textContent).not.toContain('최근 사용');
  });

  it('기록이 없으면 배지가 없다', () => {
    render(<LoginScreen />);
    expect(screen.queryByText('최근 사용')).toBeNull();
  });

  it('?error=social이면 소셜 로그인 실패 안내를 보여준다', () => {
    window.history.pushState({}, '', '/login?error=social');
    render(<LoginScreen />);
    expect(screen.getByText(/소셜 로그인에 실패/)).toBeTruthy();
    window.history.pushState({}, '', '/login'); // 정리
  });

  it('일반 진입에는 실패 안내가 없다', () => {
    window.history.pushState({}, '', '/login');
    render(<LoginScreen />);
    expect(screen.queryByText(/소셜 로그인에 실패/)).toBeNull();
  });
});
