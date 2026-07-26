// 소셜 콜백 화면 — 일회용 코드 교환 후 라우팅

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const loginWithCode = vi.fn();
const navigate = vi.fn();
let searchString = '';

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(searchString), vi.fn()],
}));
vi.mock('./AuthContext.js', () => ({
  useAuth: () => ({ loginWithCode }),
}));

import { SocialCallbackScreen } from './SocialCallbackScreen.js';

describe('SocialCallbackScreen', () => {
  beforeEach(() => {
    loginWithCode.mockReset();
    navigate.mockReset();
    searchString = '';
  });

  it('코드가 있으면 교환 후 루트로 이동한다', async () => {
    searchString = 'code=abc123';
    loginWithCode.mockResolvedValue(undefined);

    render(<SocialCallbackScreen />);

    await waitFor(() => expect(loginWithCode).toHaveBeenCalledWith('abc123'));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/', { replace: true }),
    );
  });

  it('코드가 없으면 실패 UI를 보여주고 교환하지 않는다', async () => {
    searchString = '';

    render(<SocialCallbackScreen />);

    await waitFor(() =>
      expect(screen.getByText(/로그인에 실패/)).toBeTruthy(),
    );
    expect(loginWithCode).not.toHaveBeenCalled();
  });

  it('교환이 실패하면 실패 UI를 보여준다', async () => {
    searchString = 'code=bad';
    loginWithCode.mockRejectedValue(new Error('invalid'));

    render(<SocialCallbackScreen />);

    await waitFor(() =>
      expect(screen.getByText(/로그인에 실패/)).toBeTruthy(),
    );
  });
});
