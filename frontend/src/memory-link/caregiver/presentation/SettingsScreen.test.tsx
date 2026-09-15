// SettingsScreen — 메뉴 목록 표시·이동

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const logout = vi.fn();
vi.mock('../../shared/AuthContext.js', () => ({
  useAuth: () => ({ logout }),
}));

import { SettingsScreen } from './SettingsScreen.js';

describe('SettingsScreen — 메뉴', () => {
  beforeEach(() => {
    logout.mockReset();
  });

  it('카드 메뉴(환자 정보·계정·음성 데이터 제공·로그아웃)를 보여준다', () => {
    render(<SettingsScreen onBack={() => {}} />);
    expect(screen.getByText('환자 정보')).toBeInTheDocument();
    expect(screen.getByText('계정')).toBeInTheDocument();
    expect(screen.getByText('음성 데이터 제공')).toBeInTheDocument();
    expect(screen.getByText('로그아웃')).toBeInTheDocument();
  });

  it('목록으로 돌아가기 버튼 → onBack 호출', () => {
    const onBack = vi.fn();
    render(<SettingsScreen onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: '목록으로 돌아가기' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('로그아웃 카드 클릭 → logout 호출', () => {
    render(<SettingsScreen onBack={() => {}} />);
    fireEvent.click(screen.getByText('로그아웃'));
    expect(logout).toHaveBeenCalledOnce();
  });
});
