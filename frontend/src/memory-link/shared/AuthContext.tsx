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
import { memoryLinkApi, ML_TOKEN_KEY } from './MemoryLinkApi.js';

// ─── 도메인 타입 ─────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  role: 'caregiver' | 'patient' | 'therapist';
  displayName: string;
  /** 보호자(caregiver)인 경우 연결된 환자 ID, 없으면 null */
  patientId: string | null;
}

export interface RegisterData {
  email: string;
  password: string;
  displayName: string;
  role: 'caregiver' | 'patient';
}

// ─── API 응답 타입 ────────────────────────────────────────────

interface LoginResponseRaw {
  access_token: string;
}

interface MeResponseRaw {
  id: string;
  email: string;
  role: string;
  displayName: string;
  patientId: string | null;
}

// ─── 런타임 타입 검증 ─────────────────────────────────────────

function isLoginResponse(value: unknown): value is LoginResponseRaw {
  return (
    typeof value === 'object' &&
    value !== null &&
    'access_token' in value &&
    typeof (value as Record<string, unknown>).access_token === 'string'
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(ML_TOKEN_KEY),
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);

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
  }, [clearAuth]);

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
      saveToken(raw.access_token);

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
        role: data.role,
      });
      const raw = response.data;
      if (!isLoginResponse(raw)) {
        throw new Error('서버 응답 형식이 올바르지 않습니다.');
      }
      saveToken(raw.access_token);

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
    clearAuth();
  }, [clearAuth]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
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

