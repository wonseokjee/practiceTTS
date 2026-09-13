// AuthContext × QabOutbox — 계정 경계 테스트(R7, 계획 2-2A)
//
// 검증 포인트:
//  - logout() → 대기열을 통째로 비운다(다음 사람이 이어 써도 안 새어 나간다)
//  - 로그인 성공 → 대기열에 남아 있던 실패 제출을 다시 시도한다

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const ME_RESPONSE = {
  data: {
    id: 'u1',
    email: 'a@b.com',
    role: 'caregiver',
    displayName: '보호자',
    patientId: 'p1',
  },
};

const postMock = vi.fn();
const getMock = vi.fn().mockResolvedValue(ME_RESPONSE);
vi.mock('./MemoryLinkApi.js', () => ({
  memoryLinkApi: {
    post: (...args: unknown[]) => postMock(...args),
    get: (...args: unknown[]) => getMock(...args),
  },
  ML_TOKEN_KEY: 'ml_token',
  ML_PATIENT_MODE_KEY: 'ml_patient_mode',
  ML_LAST_PROVIDER_KEY: 'ml_last_provider',
}));

import { AuthProvider, useAuth } from './AuthContext.js';
import { quizApi } from '../patient/quiz/infrastructure/QuizApi.js';
import { enqueue, size } from './QabOutbox.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext × QabOutbox', () => {
  beforeEach(() => {
    localStorage.clear();
    postMock.mockReset();
    getMock.mockReset().mockResolvedValue(ME_RESPONSE);
  });

  it('logout()은 재전송 대기열을 통째로 비운다', () => {
    enqueue('tok-1', [{ subtest: 'word', itemRef: 'a', isCorrect: true }]);
    expect(size()).toBe(1);

    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.logout());

    expect(size()).toBe(0);
  });

  it('로그인 성공 시 대기열에 남아있던 실패 제출을 다시 시도한다', async () => {
    enqueue('stale-session', [
      { subtest: 'word', itemRef: 'a', isCorrect: true },
    ]);
    postMock.mockResolvedValue({ data: { accessToken: 'jwt' } });
    const submitSpy = vi
      .spyOn(quizApi, 'submitQabResults')
      .mockResolvedValue({ saved: 1 });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.login('a@b.com', 'pw');
    });

    await waitFor(() => expect(submitSpy).toHaveBeenCalled());
    expect(submitSpy).toHaveBeenCalledWith(
      'stale-session',
      [{ subtest: 'word', itemRef: 'a', isCorrect: true }],
      undefined,
      undefined,
      undefined,
    );
    await waitFor(() => expect(size()).toBe(0));

    submitSpy.mockRestore();
  });
});
