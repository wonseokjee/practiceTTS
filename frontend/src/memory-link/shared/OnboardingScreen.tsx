/**
 * 소셜 최초 로그인 온보딩 화면 (/onboarding)
 *
 * 카카오 등으로 처음 로그인한 보호자는 "어르신 성함 + 환자 모드 PIN"을 아직
 * 안 줬다(needsOnboarding=true). 여기서 받아 환자 레코드를 만들고 연결한다.
 * 완료되면 needsOnboarding이 false가 되어 보호자 대시보드로 진입한다.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.js';
import { memoryLinkApi } from './MemoryLinkApi.js';

export function OnboardingScreen() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [patientDisplayName, setPatientDisplayName] = useState('');
  const [patientModePin, setPatientModePin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    // 더블클릭/엔터 연타로 두 번 제출되면 환자 레코드가 중복 생성될 수 있다.
    // 버튼 disable은 리렌더 뒤에나 걸리므로, 핸들러 진입에서 먼저 막는다.
    if (isSubmitting) return;
    setError(null);

    if (patientDisplayName.trim().length === 0) {
      setError('어르신 성함을 입력해주세요.');
      return;
    }
    if (!/^[0-9]{4}$/.test(patientModePin)) {
      setError('환자 모드 PIN은 4자리 숫자여야 해요.');
      return;
    }

    setIsSubmitting(true);
    try {
      await memoryLinkApi.post('/auth/complete-onboarding', {
        patientDisplayName: patientDisplayName.trim(),
        patientModePin,
      });
      await refreshUser();
      navigate('/caregiver', { replace: true });
    } catch {
      setError('저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F6F3] p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[#E8E4DC] bg-white p-6">
        <h1 className="text-xl font-bold text-[#1A1916]">환영해요{user?.displayName ? `, ${user.displayName}님` : ''}</h1>
        <p className="mt-1 mb-5 text-sm text-[#5C6661]">
          시작하기 전에 돌보시는 어르신 정보를 알려주세요.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="ob-patient-name"
              className="block text-sm font-medium text-[#1A1916] mb-1"
            >
              어르신 성함
            </label>
            <input
              id="ob-patient-name"
              type="text"
              value={patientDisplayName}
              onChange={(e) => setPatientDisplayName(e.target.value)}
              className="w-full min-h-[48px] px-3 py-2 border border-[#E8E4DC] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A56] focus:border-transparent"
              placeholder="돌보시는 어르신의 성함"
            />
          </div>

          <div>
            <label
              htmlFor="ob-pin"
              className="block text-sm font-medium text-[#1A1916] mb-1"
            >
              환자 모드 PIN (4자리 숫자)
            </label>
            <input
              id="ob-pin"
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
              어르신께 기기를 건넸다가 돌아올 때 쓰는 4자리 숫자예요.
            </p>
          </div>

          {error !== null && (
            <p
              role="alert"
              className="text-sm text-[#C94040] bg-[#C94040]/10 px-3 py-2 rounded-lg"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[48px] py-2 px-4 bg-[#2D6A56] text-white font-medium rounded-full hover:bg-[#1F5240] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? '저장 중...' : '시작하기'}
          </button>
        </form>
      </div>
    </div>
  );
}
