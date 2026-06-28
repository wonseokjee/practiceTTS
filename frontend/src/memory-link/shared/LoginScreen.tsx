/**
 * 로그인 / 회원가입 화면
 *
 * - 탭 전환: 로그인 | 회원가입
 * - 로그인: email, password
 * - 회원가입(보호자 전용): email, password, 내 이름, 어르신 성함, 환자 모드 PIN
 *   (환자 레코드는 백엔드가 회원가입 시 함께 생성 — 환자는 직접 로그인하지 않음)
 * - 성공 시 AuthContext가 user 상태를 갱신하여 라우터가 자동 리다이렉트
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from './AuthContext.js';
import type { RegisterData } from './AuthContext.js';
import { extractErrorMessage } from './extractErrorMessage.js';

type Tab = 'login' | 'register';

// ─── 로그인 폼 ────────────────────────────────────────────────

function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (email.trim() === '') {
      setError('이메일을 입력해주세요.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('올바른 이메일 형식이 아닙니다.');
      return;
    }
    if (password === '') {
      setError('비밀번호를 입력해주세요.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
      <div>
        <label htmlFor="login-email" className="block text-sm font-medium text-[#1A1916] mb-1">
          이메일
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-[#E8E4DC] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A56] focus:border-transparent"
          placeholder="example@email.com"
        />
      </div>

      <div>
        <label htmlFor="login-password" className="block text-sm font-medium text-[#1A1916] mb-1">
          비밀번호
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[#E8E4DC] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A56] focus:border-transparent"
          placeholder="비밀번호를 입력하세요"
        />
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-[#C94040] bg-[#C94040]/10 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full min-h-[48px] py-2 px-4 bg-[#2D6A56] text-white font-medium rounded-full hover:bg-[#1F5240] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? '로그인 중...' : '로그인'}
      </button>
    </form>
  );
}

// ─── 회원가입 폼 ──────────────────────────────────────────────

function RegisterForm() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [patientDisplayName, setPatientDisplayName] = useState('');
  const [patientModePin, setPatientModePin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (email.trim() === '') {
      setError('이메일을 입력해주세요.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('올바른 이메일 형식이 아닙니다.');
      return;
    }
    if (password.length < 8) {
      setError('비밀번호는 최소 8자 이상이어야 합니다.');
      return;
    }
    if (displayName.trim() === '') {
      setError('이름을 입력해주세요.');
      return;
    }
    if (patientDisplayName.trim() === '') {
      setError('어르신 성함을 입력해주세요.');
      return;
    }
    if (!/^[0-9]{4}$/.test(patientModePin)) {
      setError('환자 모드 PIN은 4자리 숫자여야 합니다.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    const data: RegisterData = {
      email,
      password,
      displayName,
      patientDisplayName,
      patientModePin,
    };
    try {
      await register(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
      <div>
        <label htmlFor="reg-email" className="block text-sm font-medium text-[#1A1916] mb-1">
          이메일
        </label>
        <input
          id="reg-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-[#E8E4DC] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A56] focus:border-transparent"
          placeholder="example@email.com"
        />
      </div>

      <div>
        <label htmlFor="reg-password" className="block text-sm font-medium text-[#1A1916] mb-1">
          비밀번호
        </label>
        <input
          id="reg-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[#E8E4DC] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A56] focus:border-transparent"
          placeholder="비밀번호를 입력하세요"
        />
      </div>

      <div>
        <label htmlFor="reg-display-name" className="block text-sm font-medium text-[#1A1916] mb-1">
          내 이름 (보호자)
        </label>
        <input
          id="reg-display-name"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full min-h-[48px] px-3 py-2 border border-[#E8E4DC] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A56] focus:border-transparent"
          placeholder="내 이름을 입력하세요"
        />
      </div>

      <div>
        <label htmlFor="reg-patient-name" className="block text-sm font-medium text-[#1A1916] mb-1">
          어르신 성함
        </label>
        <input
          id="reg-patient-name"
          type="text"
          value={patientDisplayName}
          onChange={(e) => setPatientDisplayName(e.target.value)}
          className="w-full min-h-[48px] px-3 py-2 border border-[#E8E4DC] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A56] focus:border-transparent"
          placeholder="돌보시는 어르신의 성함"
        />
      </div>

      <div>
        <label htmlFor="reg-pin" className="block text-sm font-medium text-[#1A1916] mb-1">
          환자 모드 PIN (4자리 숫자)
        </label>
        <input
          id="reg-pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          value={patientModePin}
          onChange={(e) =>
            setPatientModePin(e.target.value.replace(/\D/g, '').slice(0, 4))
          }
          className="w-full min-h-[48px] px-3 py-2 border border-[#E8E4DC] rounded-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-[#2D6A56] focus:border-transparent"
          placeholder="••••"
        />
        <p className="mt-1 text-xs text-[#6B6560]">
          어르신께 기기를 건넸다가 돌아올 때 사용하는 4자리 숫자예요.
        </p>
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-[#C94040] bg-[#C94040]/10 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full min-h-[48px] py-2 px-4 bg-[#2D6A56] text-white font-medium rounded-full hover:bg-[#1F5240] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? '가입 중...' : '회원가입'}
      </button>
    </form>
  );
}

// ─── 메인 화면 ────────────────────────────────────────────────

export function LoginScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('login');

  return (
    <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.08)] overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 pt-8 pb-4 text-center">
          <h1 className="text-2xl font-bold text-[#1A1916]">Memory Link</h1>
          <p className="mt-1 text-sm text-[#6B6560]">인지 훈련 및 기억 연결 플랫폼</p>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-[#E8E4DC] mx-6">
          <button
            type="button"
            onClick={() => setActiveTab('login')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'login'
                ? 'text-[#2D6A56] border-b-2 border-[#2D6A56]'
                : 'text-[#6B6560] hover:text-[#1A1916]'
            }`}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('register')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'register'
                ? 'text-[#2D6A56] border-b-2 border-[#2D6A56]'
                : 'text-[#6B6560] hover:text-[#1A1916]'
            }`}
          >
            회원가입
          </button>
        </div>

        {/* 폼 */}
        <div className="px-6 py-6">
          {activeTab === 'login' ? <LoginForm /> : <RegisterForm />}
        </div>
      </div>
    </div>
  );
}
