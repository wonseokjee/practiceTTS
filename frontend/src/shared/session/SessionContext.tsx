/**
 * 검사 세션 Context
 *
 * 제공하는 기능:
 * - 현재 활성 세션(sessionId, patientId) 조회
 * - 환자 ID 등록 후 새 세션 시작
 * - 세션 종료 (초기화)
 *
 * 상태는 localStorage에 영속화하여 새로고침 후에도 유지한다.
 */

import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { generateSessionId } from './Session.js';
import type { Session } from './Session.js';

const STORAGE_KEY = 'practiv_session';

interface SessionContextValue {
  session: Session | null;
  startSession: (patientId: string, patientName?: string) => void;
  endSession: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function loadPersistedSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'sessionId' in parsed &&
      'patientId' in parsed &&
      typeof (parsed as Record<string, unknown>).sessionId === 'string' &&
      typeof (parsed as Record<string, unknown>).patientId === 'string'
    ) {
      return parsed as Session;
    }
    return null;
  } catch {
    return null;
  }
}

function persistSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearPersistedSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadPersistedSession);

  const startSession = useCallback((patientId: string, patientName?: string) => {
    const trimmedName = patientName?.trim();
    const newSession: Session = {
      sessionId: generateSessionId(),
      patientId: patientId.trim(),
      ...(trimmedName ? { patientName: trimmedName } : {}),
    };
    persistSession(newSession);
    setSession(newSession);
  }, []);

  const endSession = useCallback(() => {
    clearPersistedSession();
    setSession(null);
  }, []);

  return (
    <SessionContext.Provider value={{ session, startSession, endSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error('useSessionContext must be used within a SessionProvider.');
  }
  return ctx;
}
