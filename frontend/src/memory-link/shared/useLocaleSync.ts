// 화면 로케일을 계정 설정에 맞춘다 — i18n 규약 4(`shared/i18n/i18n.ts` 머리말).
//
//   isPatientMode (또는 환자 직접 로그인) → patient_locale
//   그 외(보호자 화면)                     → caregiver_locale
//
// 로그인이 아니라 **모드 토글**로 언어가 갈린다(`enterPatientMode`). 그래서
// i18next 기본 구성(로그인 때 한 번 정함)으로는 안 되고, 모드가 바뀔 때마다
// 다시 고른다. 값은 GET /settings/locale(계획서 0-5c)에서 받는다 — `/auth/me`는
// 본인 행의 로케일만 줘서, 보호자에겐 환자 로케일이 없다.
//
// **못 받으면 기본 로케일이다.** 문이 닫힌 동안(서버 지원 목록이 ko-KR뿐)은
// 저장된 값도 전부 ko-KR이라 동작이 지금과 같다.

import { useEffect, useRef, useState } from 'react';
import { i18n, resolveUiLocale } from '../../shared/i18n/i18n.js';
import type { AuthUser } from './AuthContext.js';
import { ML_TOKEN_KEY } from './MemoryLinkApi.js';
import { settingsApi, type LocaleSettings } from './SettingsApi.js';

export interface LocaleSyncDeps {
  fetchLocales?: () => Promise<LocaleSettings>;
  changeLanguage?: (locale: string) => unknown;
  /**
   * 실제 토큰이 저장돼 있는가. **개발 바이패스(가짜 계정)는 토큰을 상태에만
   * 두고 저장하지 않는다** — 그때 인증 API를 부르면 헤더 없이 401을 받고,
   * `memoryLinkApi` 인터셉터가 곧장 /login으로 보낸다. 앱이 켜지자마자 튕기지
   * 않도록 저장된 토큰이 있을 때만 부른다.
   */
  hasStoredToken?: () => boolean;
}

/** 로케일을 읽을 수 있는 계정인가 — 온보딩 끝난 보호자 또는 환자. */
function canReadLocales(user: AuthUser | null): boolean {
  if (user === null || user.needsOnboarding) return false;
  if (user.role === 'caregiver') return user.patientId !== null;
  return user.role === 'patient';
}

/** 지금 화면이 써야 할 로케일(순수 함수). */
export function chooseUiLocale(
  user: AuthUser | null,
  isPatientMode: boolean,
  locales: LocaleSettings | null,
): string {
  if (user === null || locales === null) return resolveUiLocale(null);
  const readsPatient = isPatientMode || user.role === 'patient';
  return resolveUiLocale(
    readsPatient
      ? locales.patientLocale
      : (locales.caregiverLocale ?? locales.patientLocale),
  );
}

/** 계정 로케일을 받아 i18n 언어를 맞추고, 고른 로케일을 돌려준다. */
export function useLocaleSync(
  user: AuthUser | null,
  isPatientMode: boolean,
  deps?: LocaleSyncDeps,
): string {
  const fetchRef = useRef(deps?.fetchLocales ?? (() => settingsApi.getLocale()));
  const changeRef = useRef(
    deps?.changeLanguage ?? ((locale: string) => i18n.changeLanguage(locale)),
  );
  const tokenRef = useRef(
    deps?.hasStoredToken ?? (() => localStorage.getItem(ML_TOKEN_KEY) !== null),
  );
  // 받은 값을 **누구의 값인지**와 함께 둔다 — 계정이 바뀌면 이전 사람의
  // 로케일이 새 계정 화면에 잠깐이라도 쓰이지 않는다.
  const [fetched, setFetched] = useState<{
    userId: string;
    locales: LocaleSettings;
  } | null>(null);

  const readable = canReadLocales(user);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!readable || userId === null || !tokenRef.current()) return;
    let cancelled = false;
    fetchRef.current().then(
      (locales) => {
        if (!cancelled) setFetched({ userId, locales });
      },
      () => {
        // 못 받으면 기본 로케일로 둔다(파일 머리말).
      },
    );
    return () => {
      cancelled = true;
    };
  }, [readable, userId]);

  const locales =
    readable && fetched !== null && fetched.userId === userId
      ? fetched.locales
      : null;
  const target = chooseUiLocale(readable ? user : null, isPatientMode, locales);

  useEffect(() => {
    void changeRef.current(target);
  }, [target]);

  return target;
}
