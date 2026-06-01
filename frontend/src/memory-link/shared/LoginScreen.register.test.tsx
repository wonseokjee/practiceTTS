// LoginScreen 회원가입 폼 — 보호자 전용 재설계 테스트

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const registerMock = vi.fn();
vi.mock('./AuthContext.js', () => ({
  useAuth: () => ({ login: vi.fn(), register: registerMock }),
}));

import { LoginScreen } from './LoginScreen.js';

function openRegisterTab() {
  render(<LoginScreen />);
  // 로그인 탭 활성 상태에서는 '회원가입' 버튼이 탭 하나뿐
  fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
}

/** 제출 버튼(type=submit)만 특정해서 클릭 (탭 버튼과 이름 충돌 회피) */
function clickSubmit() {
  const submit = screen
    .getAllByRole('button', { name: '회원가입' })
    .find((b) => b.getAttribute('type') === 'submit');
  fireEvent.click(submit as HTMLElement);
}

describe('LoginScreen 회원가입(보호자 전용)', () => {
  beforeEach(() => registerMock.mockReset());

  it('역할(보호자/환자) 라디오 토글이 없다', () => {
    openRegisterTab();
    expect(screen.queryByText('역할')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('어르신 성함 + 환자 모드 PIN 필드가 있다', () => {
    openRegisterTab();
    expect(screen.getByLabelText('어르신 성함')).toBeTruthy();
    expect(screen.getByLabelText('환자 모드 PIN (4자리 숫자)')).toBeTruthy();
  });

  it('어르신 성함 누락 시 제출 차단 (register 미호출)', async () => {
    registerMock.mockResolvedValue(undefined);
    openRegisterTab();
    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'cg@test.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('내 이름 (보호자)'), {
      target: { value: '보호자' },
    });
    // 어르신 성함 비움
    fireEvent.change(screen.getByLabelText('환자 모드 PIN (4자리 숫자)'), {
      target: { value: '1234' },
    });
    clickSubmit();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('어르신 성함'),
    );
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('정상 입력 → register가 patientDisplayName/patientModePin 포함 호출', async () => {
    registerMock.mockResolvedValue(undefined);
    openRegisterTab();
    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'cg@test.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('내 이름 (보호자)'), {
      target: { value: '보호자' },
    });
    fireEvent.change(screen.getByLabelText('어르신 성함'), {
      target: { value: '어르신' },
    });
    fireEvent.change(screen.getByLabelText('환자 모드 PIN (4자리 숫자)'), {
      target: { value: '1234' },
    });
    clickSubmit();
    await waitFor(() =>
      expect(registerMock).toHaveBeenCalledWith({
        email: 'cg@test.com',
        password: 'password123',
        displayName: '보호자',
        patientDisplayName: '어르신',
        patientModePin: '1234',
      }),
    );
  });
});
