// AccountLinkScreen — 계정 연결/해제 동작

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const refreshUser = vi.fn();
let mockUser: { linkedProviders: string[] } | null;

vi.mock('../../shared/AuthContext.js', () => ({
  useAuth: () => ({ user: mockUser, refreshUser }),
}));

const post = vi.fn();
const del = vi.fn();
vi.mock('../../shared/MemoryLinkApi.js', () => ({
  API_BASE_URL: 'http://api.test',
  memoryLinkApi: {
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

import { AccountLinkScreen } from './AccountLinkScreen.js';

describe('AccountLinkScreen', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    // window.location.href 대입을 관찰하기 위해 쓰기 가능한 스텁으로 교체.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '', pathname: '/caregiver', search: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('연결 상태를 provider별로 보여준다', () => {
    mockUser = { linkedProviders: ['kakao'] };
    render(<AccountLinkScreen onBack={vi.fn()} />);

    // 카카오는 연결됨(해제 버튼), 구글은 연결 안 됨(연결 버튼)
    expect(screen.getByRole('button', { name: '연결 해제' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '연결하기' })).toBeTruthy();
  });

  it('연결하기 → 의도 쿠키 심고(withCredentials) 소셜 인가로 이동한다', async () => {
    mockUser = { linkedProviders: ['kakao'] };
    post.mockResolvedValueOnce({ data: { ok: true } });
    render(<AccountLinkScreen onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '연결하기' }));

    await waitFor(() => {
      expect(window.location.href).toBe('http://api.test/auth/google/link');
    });
    // URL에 코드 없음(쿠키로 전달), start는 withCredentials로 호출
    expect(post).toHaveBeenCalledWith('/auth/link/start', {}, {
      withCredentials: true,
    });
  });

  it('마지막 하나 남은 연결은 해제 버튼이 비활성화된다', () => {
    mockUser = { linkedProviders: ['kakao'] };
    render(<AccountLinkScreen onBack={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: '연결 해제' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('해제 실패(403)면 마지막 수단 안내를 보여준다', async () => {
    mockUser = { linkedProviders: ['kakao', 'google'] };
    del.mockRejectedValueOnce({ response: { status: 403 } });
    render(<AccountLinkScreen onBack={vi.fn()} />);

    // 두 개 연결 상태 → 해제 버튼 2개 중 첫 번째(카카오) 클릭
    const unlinkButtons = screen.getAllByRole('button', { name: '연결 해제' });
    fireEvent.click(unlinkButtons[0]);

    await waitFor(() => {
      expect(
        screen.getByText('마지막 로그인 수단은 해제할 수 없어요.'),
      ).toBeTruthy();
    });
  });

  it('복귀 알림(notice)을 배너로 표시한다', () => {
    mockUser = { linkedProviders: ['kakao', 'google'] };
    render(
      <AccountLinkScreen
        onBack={vi.fn()}
        notice={{ kind: 'success', text: '구글 계정을 연결했어요.' }}
      />,
    );

    expect(screen.getByText('구글 계정을 연결했어요.')).toBeTruthy();
  });
});
