// AuthContext — 환자 모드 진입/해제 + localStorage 영속 테스트

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// memoryLinkApi 모킹 (verify-pin 호출 제어)
const postMock = vi.fn();
vi.mock('./MemoryLinkApi.js', () => ({
  memoryLinkApi: {
    post: (...args: unknown[]) => postMock(...args),
    get: vi.fn(),
  },
  ML_TOKEN_KEY: 'ml_token',
  ML_PATIENT_MODE_KEY: 'ml_patient_mode',
}));

import { AuthProvider, useAuth } from './AuthContext.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext 환자 모드', () => {
  beforeEach(() => {
    localStorage.clear();
    postMock.mockReset();
  });

  it('초기 isPatientMode는 false', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isPatientMode).toBe(false);
  });

  it('enterPatientMode → isPatientMode=true + localStorage 영속', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.enterPatientMode());
    expect(result.current.isPatientMode).toBe(true);
    expect(localStorage.getItem('ml_patient_mode')).toBe('true');
  });

  it('localStorage에 플래그가 있으면 초기값이 true (새로고침 유지)', () => {
    localStorage.setItem('ml_patient_mode', 'true');
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isPatientMode).toBe(true);
  });

  it('exitPatientMode 성공(verify-pin 200) → false + 플래그 제거 + true 반환', async () => {
    postMock.mockResolvedValue({ data: { ok: true } });
    localStorage.setItem('ml_patient_mode', 'true');
    const { result } = renderHook(() => useAuth(), { wrapper });

    let ok = false;
    await act(async () => {
      ok = await result.current.exitPatientMode('1234');
    });
    expect(ok).toBe(true);
    await waitFor(() => expect(result.current.isPatientMode).toBe(false));
    expect(localStorage.getItem('ml_patient_mode')).toBeNull();
    expect(postMock).toHaveBeenCalledWith('/auth/patient-mode/verify-pin', {
      pin: '1234',
    });
  });

  it('exitPatientMode 실패(verify-pin 401) → 모드 유지 + false 반환', async () => {
    postMock.mockRejectedValue(new Error('401'));
    localStorage.setItem('ml_patient_mode', 'true');
    const { result } = renderHook(() => useAuth(), { wrapper });

    let ok = true;
    await act(async () => {
      ok = await result.current.exitPatientMode('0000');
    });
    expect(ok).toBe(false);
    expect(result.current.isPatientMode).toBe(true);
    expect(localStorage.getItem('ml_patient_mode')).toBe('true');
  });
});
