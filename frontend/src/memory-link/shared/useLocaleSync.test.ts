// useLocaleSync — 모드 토글로 언어가 갈린다(i18n 규약 4)
//
// 검증 포인트:
//  - 보호자 화면은 caregiver_locale, 환자 모드는 patient_locale
//  - 못 받으면·모르는 로케일이면 ko-KR
//  - 저장된 토큰이 없으면(개발 바이패스) 부르지 않는다 — 401 → /login 튕김 방지
//  - 온보딩 전 보호자·로그아웃 상태는 부르지 않는다

import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { AuthUser } from './AuthContext.js';
import { useLocaleSync } from './useLocaleSync.js';
import type { LocaleSettings } from './SettingsApi.js';

const CAREGIVER: AuthUser = {
  id: 'c1',
  email: 'c@x.com',
  role: 'caregiver',
  displayName: '보호자',
  patientId: 'p1',
  patientDisplayName: '어르신',
  needsOnboarding: false,
  linkedProviders: [],
};

const MIXED: LocaleSettings = { patientLocale: 'en-US', caregiverLocale: 'ko-KR' };

function deps(overrides?: {
  fetchLocales?: () => Promise<LocaleSettings>;
  hasStoredToken?: () => boolean;
}) {
  return {
    fetchLocales: overrides?.fetchLocales ?? vi.fn(async () => MIXED),
    changeLanguage: vi.fn(),
    hasStoredToken: overrides?.hasStoredToken ?? (() => true),
  };
}

describe('useLocaleSync', () => {
  it('보호자 화면은 보호자 로케일, 환자 모드로 바꾸면 환자 로케일', async () => {
    const d = deps();
    const { result, rerender } = renderHook(
      ({ mode }: { mode: boolean }) => useLocaleSync(CAREGIVER, mode, d),
      { initialProps: { mode: false } },
    );
    await waitFor(() => expect(d.fetchLocales).toHaveBeenCalledTimes(1));
    expect(result.current).toBe('ko-KR');

    rerender({ mode: true });

    await waitFor(() => expect(result.current).toBe('en-US'));
    expect(d.changeLanguage).toHaveBeenLastCalledWith('en-US');
    // 모드 토글은 다시 부르지 않는다 — 값은 이미 둘 다 받았다.
    expect(d.fetchLocales).toHaveBeenCalledTimes(1);
  });

  it('환자 직접 로그인은 모드와 무관하게 환자 로케일', async () => {
    const d = deps({
      fetchLocales: vi.fn(async () => ({
        patientLocale: 'en-US',
        caregiverLocale: null,
      })),
    });
    const patient: AuthUser = { ...CAREGIVER, id: 'p9', role: 'patient', patientId: null };
    const { result } = renderHook(() => useLocaleSync(patient, false, d));

    await waitFor(() => expect(result.current).toBe('en-US'));
  });

  it('저장된 토큰이 없으면(개발 바이패스) 부르지 않는다 — 401이 곧장 /login으로 보낸다', async () => {
    const d = deps({ hasStoredToken: () => false });
    const { result } = renderHook(() => useLocaleSync(CAREGIVER, true, d));

    await Promise.resolve();
    expect(d.fetchLocales).not.toHaveBeenCalled();
    expect(result.current).toBe('ko-KR');
  });

  it('못 받으면 ko-KR', async () => {
    const d = deps({ fetchLocales: vi.fn(async () => Promise.reject(new Error('x'))) });
    const { result } = renderHook(() => useLocaleSync(CAREGIVER, true, d));

    await waitFor(() => expect(d.fetchLocales).toHaveBeenCalled());
    expect(result.current).toBe('ko-KR');
  });

  it('그릴 수 없는 로케일이 와도 ko-KR', async () => {
    const d = deps({
      fetchLocales: vi.fn(async () => ({
        patientLocale: 'fr-FR',
        caregiverLocale: 'fr-FR',
      })),
    });
    const { result } = renderHook(() => useLocaleSync(CAREGIVER, true, d));

    await waitFor(() => expect(d.fetchLocales).toHaveBeenCalled());
    expect(result.current).toBe('ko-KR');
  });

  it.each([
    ['로그아웃', null],
    ['온보딩 전 보호자', { ...CAREGIVER, patientId: null, needsOnboarding: true }],
  ])('%s 상태는 부르지 않고 ko-KR', async (_label, user) => {
    const d = deps();
    const { result } = renderHook(() =>
      useLocaleSync(user as AuthUser | null, false, d),
    );

    await Promise.resolve();
    expect(d.fetchLocales).not.toHaveBeenCalled();
    expect(result.current).toBe('ko-KR');
  });

  it('계정이 바뀌면 새 계정의 값이 올 때까지 이전 계정의 로케일을 쓰지 않는다', async () => {
    let resolveSecond!: (v: LocaleSettings) => void;
    const second = new Promise<LocaleSettings>((r) => {
      resolveSecond = r;
    });
    const fetchLocales = vi
      .fn<() => Promise<LocaleSettings>>()
      .mockResolvedValueOnce({ patientLocale: 'en-US', caregiverLocale: 'en-US' })
      .mockReturnValueOnce(second);
    const d = deps({ fetchLocales });
    const other: AuthUser = { ...CAREGIVER, id: 'c2' };

    const { result, rerender } = renderHook(
      ({ user }: { user: AuthUser }) => useLocaleSync(user, false, d),
      { initialProps: { user: CAREGIVER } },
    );
    await waitFor(() => expect(result.current).toBe('en-US'));

    rerender({ user: other });

    // 두 번째 값이 아직 안 왔다 — 첫 계정의 en-US가 새 화면에 남으면 안 된다.
    expect(fetchLocales).toHaveBeenCalledTimes(2);
    expect(result.current).toBe('ko-KR');

    // 새 계정의 값이 오면 그때는 그 값을 쓴다 — 가드가 영영 막는 게 아니다.
    resolveSecond({ patientLocale: 'en-US', caregiverLocale: 'en-US' });
    await waitFor(() => expect(result.current).toBe('en-US'));
  });
});
