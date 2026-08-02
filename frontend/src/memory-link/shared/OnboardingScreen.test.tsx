// 소셜 온보딩 화면 — 어르신 성함·PIN 입력 → 환자 연결

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navigate = vi.fn();
const refreshUser = vi.fn();
const post = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));
vi.mock('./AuthContext.js', () => ({
  useAuth: () => ({ user: { displayName: '홍길동' }, refreshUser }),
}));
vi.mock('./MemoryLinkApi.js', () => ({
  memoryLinkApi: { post: (...args: unknown[]) => post(...args) },
}));

import { OnboardingScreen } from './OnboardingScreen.js';

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('OnboardingScreen', () => {
  beforeEach(() => {
    navigate.mockReset();
    refreshUser.mockReset();
    post.mockReset();
  });

  it('성함·PIN 입력 후 제출하면 온보딩 API 호출·유저 갱신·대시보드 이동', async () => {
    post.mockResolvedValue({ data: {} });
    refreshUser.mockResolvedValue(undefined);

    render(<OnboardingScreen />);
    fill('어르신 성함', '박순자');
    fill('환자 모드 PIN (4자리 숫자)', '1234');
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/auth/complete-onboarding', {
        patientDisplayName: '박순자',
        patientModePin: '1234',
      }),
    );
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/caregiver', { replace: true }),
    );
  });

  it('성함이 비면 제출을 막는다(API 미호출)', () => {
    render(<OnboardingScreen />);
    fill('환자 모드 PIN (4자리 숫자)', '1234');
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/어르신 성함을 입력/)).toBeTruthy();
  });

  it('PIN이 4자리가 아니면 제출을 막는다', () => {
    render(<OnboardingScreen />);
    fill('어르신 성함', '박순자');
    // 숫자만 남기고 4자리 미만
    fill('환자 모드 PIN (4자리 숫자)', '12');
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));

    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/PIN은 4자리/)).toBeTruthy();
  });
});
