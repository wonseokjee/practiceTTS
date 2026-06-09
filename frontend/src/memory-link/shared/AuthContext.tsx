/**
 * Memory Link 인증 Context
 *
 * 기능:
 * - JWT 기반 로그인 / 회원가입 / 로그아웃
 * - localStorage('ml_token')에 토큰 영속화
 * - 앱 시작 시 토큰이 있으면 GET /auth/me 로 사용자 상태 복원
 * - useAuth() 훅으로 하위 컴포넌트에서 접근
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import {
  memoryLinkApi,
  ML_PATIENT_MODE_KEY,
  ML_TOKEN_KEY,
} from './MemoryLinkApi.js';

// ─── 도메인 타입 ─────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  role: 'caregiver' | 'patient' | 'therapist';
  displayName: string;
  /** 보호자(caregiver)인 경우 연결된 환자 ID, 없으면 null */
  patientId: string | null;
  /** 보호자가 돌보는 환자(어르신) 성함 — 환자 모드 인사말 등에 사용. 없으면 null */
  patientDisplayName: string | null;
}

export interface RegisterData {
  email: string;
  password: string;
  /** 보호자 본인 이름 */
  displayName: string;
  /** 돌보는 환자(어르신) 성함 — 회원가입 시 환자 레코드 생성에 사용 */
  patientDisplayName: string;
  /** 환자 모드 → 보호자 복귀 시 사용하는 4자리 PIN */
  patientModePin: string;
}

// ─── API 응답 타입 ────────────────────────────────────────────

interface LoginResponseRaw {
  accessToken: string;
}

interface MeResponseRaw {
  id: string;
  email: string;
  role: string;
  displayName: string;
  patientId: string | null;
  patientDisplayName?: string | null;
}

// ─── 런타임 타입 검증 ─────────────────────────────────────────

function isLoginResponse(value: unknown): value is LoginResponseRaw {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accessToken' in value &&
    typeof (value as Record<string, unknown>).accessToken === 'string'
  );
}

function isMeResponse(value: unknown): value is MeResponseRaw {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.role === 'string' &&
    typeof obj.displayName === 'string'
  );
}

function toAuthUser(raw: MeResponseRaw): AuthUser {
  const role: AuthUser['role'] =
    raw.role === 'caregiver' || raw.role === 'patient' || raw.role === 'therapist'
      ? raw.role
      : 'patient';
  return {
    id: raw.id,
    email: raw.email,
    role,
    displayName: raw.displayName,
    patientId: raw.patientId ?? null,
    patientDisplayName: raw.patientDisplayName ?? null,
  };
}

// ─── Context 정의 ─────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  /** 보호자 세션 내 화면 모드 — true면 환자 화면(/patient) 노출 */
  isPatientMode: boolean;
  /** 환자 모드 진입 (보호자가 기기를 환자에게 건넴) */
  enterPatientMode: () => void;
  /** 환자 모드 해제 — PIN 검증 성공 시에만 true 반환 */
  exitPatientMode: (pin: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── 개발용 자동 로그인 토글 ──────────────────────────────────
//
// VITE_DEV_AUTH (개발 빌드에서만 적용):
//   'patient' (기본) — 가짜 환자 계정으로 자동 로그인
//   'caregiver'      — 가짜 보호자 계정 (patientId는 VITE_DEV_PATIENT_ID)
//   'off'            — 바이패스 해제, 실제 로그인 화면 + 백엔드 인증 사용
//
// 'patient'/'caregiver'는 가짜 토큰('fake-local-token')을 사용하므로 실제 백엔드
// 인증이 필요한 화면(보호자 캡처 등)을 테스트하려면 'off'로 실제 로그인해야 한다.
type DevAuthMode = 'patient' | 'caregiver' | 'off';

const DEV_FAKE_TOKEN = 'fake-local-token';

function resolveDevAuthMode(): DevAuthMode {
  if (!import.meta.env.DEV) return 'off';
  const raw = (
    (import.meta.env.VITE_DEV_AUTH as string | undefined) ?? 'patient'
  ).toLowerCase();
  if (raw === 'off' || raw === 'caregiver' || raw === 'patient') {
    return raw;
  }
  return 'patient';
}

function buildDevUser(mode: DevAuthMode): AuthUser | null {
  if (mode === 'patient') {
    return {
      id: 'test-patient-uuid',
      email: 'test@patient.com',
      role: 'patient',
      displayName: '로컬 테스트 환자',
      patientId: null,
      patientDisplayName: null,
    };
  }
  if (mode === 'caregiver') {
    return {
      id: 'test-caregiver-uuid',
      email: 'test@caregiver.com',
      role: 'caregiver',
      displayName: '로컬 테스트 보호자',
      patientId:
        (import.meta.env.VITE_DEV_PATIENT_ID as string | undefined) ?? null,
      patientDisplayName: '로컬 테스트 어르신',
    };
  }
  return null;
}

// ─── Provider ─────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  // 개발 빌드일 때 VITE_DEV_AUTH에 따라 가짜 계정으로 자동 로그인 상태를 모방한다.
  const devAuthMode = resolveDevAuthMode();
  const isDevBypass = devAuthMode !== 'off';

  const [user, setUser] = useState<AuthUser | null>(() =>
    buildDevUser(devAuthMode),
  );
  const [token, setToken] = useState<string | null>(
    isDevBypass ? DEV_FAKE_TOKEN : () => localStorage.getItem(ML_TOKEN_KEY),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // 환자 모드 플래그 — localStorage 영속(환자가 새로고침해도 잠금 유지).
  // 보안 경계가 아니라 UX 잠금이며, 실제 환자 식별은 백엔드 토큰 기준.
  const [isPatientMode, setIsPatientMode] = useState<boolean>(
    () => localStorage.getItem(ML_PATIENT_MODE_KEY) === 'true',
  );

  /** 토큰 저장 및 상태 동기화 */
  const saveToken = useCallback((newToken: string) => {
    localStorage.setItem(ML_TOKEN_KEY, newToken);
    setToken(newToken);
  }, []);

  /** 토큰 삭제 및 상태 초기화 */
  const clearAuth = useCallback(() => {
    localStorage.removeItem(ML_TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  /** 앱 시작 시 저장된 토큰으로 사용자 정보 복원 */
  useEffect(() => {
    if (isDevBypass) return; // 가짜 계정 바이패스 모드에서는 API 호출을 생략한다.

    const storedToken = localStorage.getItem(ML_TOKEN_KEY);
    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    memoryLinkApi
      .get<unknown>('/auth/me')
      .then((response) => {
        if (cancelled) return;
        const raw = response.data;
        if (isMeResponse(raw)) {
          setUser(toAuthUser(raw));
        } else {
          // 응답 형식이 맞지 않으면 인증 초기화
          clearAuth();
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearAuth();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearAuth, isDevBypass]);

  /** 로그인 */
  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const response = await memoryLinkApi.post<unknown>('/auth/login', {
        email,
        password,
      });
      const raw = response.data;
      if (!isLoginResponse(raw)) {
        throw new Error('서버 응답 형식이 올바르지 않습니다.');
      }
      saveToken(raw.accessToken);

      // 사용자 정보 조회
      const meResponse = await memoryLinkApi.get<unknown>('/auth/me');
      const meRaw = meResponse.data;
      if (!isMeResponse(meRaw)) {
        throw new Error('사용자 정보 형식이 올바르지 않습니다.');
      }
      setUser(toAuthUser(meRaw));
    },
    [saveToken],
  );

  /** 회원가입 */
  const register = useCallback(
    async (data: RegisterData): Promise<void> => {
      const response = await memoryLinkApi.post<unknown>('/auth/register', {
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        patientDisplayName: data.patientDisplayName,
        patientModePin: data.patientModePin,
      });
      const raw = response.data;
      if (!isLoginResponse(raw)) {
        throw new Error('서버 응답 형식이 올바르지 않습니다.');
      }
      saveToken(raw.accessToken);

      // 사용자 정보 조회
      const meResponse = await memoryLinkApi.get<unknown>('/auth/me');
      const meRaw = meResponse.data;
      if (!isMeResponse(meRaw)) {
        throw new Error('사용자 정보 형식이 올바르지 않습니다.');
      }
      setUser(toAuthUser(meRaw));
    },
    [saveToken],
  );

  /** 로그아웃 */
  const logout = useCallback(() => {
    localStorage.removeItem(ML_PATIENT_MODE_KEY);
    setIsPatientMode(false);
    clearAuth();
  }, [clearAuth]);

  /** 환자 모드 진입 (보호자가 기기를 환자에게 건넴) */
  const enterPatientMode = useCallback(() => {
    localStorage.setItem(ML_PATIENT_MODE_KEY, 'true');
    setIsPatientMode(true);
  }, []);

  /** 환자 모드 해제 — PIN 검증 성공 시에만 true */
  const exitPatientMode = useCallback(
    async (pin: string): Promise<boolean> => {
      try {
        await memoryLinkApi.post('/auth/patient-mode/verify-pin', { pin });
        localStorage.removeItem(ML_PATIENT_MODE_KEY);
        setIsPatientMode(false);
        return true;
      } catch {
        // 401(PIN 불일치)/429(디레이) 등 — 모드 유지, 호출측이 에러 표시
        return false;
      }
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        logout,
        isPatientMode,
        enterPatientMode,
        exitPatientMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── 훅 ───────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth는 AuthProvider 내부에서만 사용 가능합니다.');
  }
  return ctx;
}

