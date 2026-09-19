/**
 * 소셜 최초 로그인 온보딩 화면 (/onboarding)
 *
 * 카카오 등으로 처음 로그인한 보호자는 "어르신 성함 + 환자 모드 PIN"을 아직
 * 안 줬다(needsOnboarding=true). 여기서 받아 환자 레코드를 만들고 연결한다.
 * 완료되면 needsOnboarding이 false가 되어 보호자 대시보드로 진입한다.
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Translator } from '../../shared/i18n/i18n.js';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.js';
import { API_BASE_URL, memoryLinkApi } from './MemoryLinkApi.js';
import { GoogleIcon, KakaoIcon } from './components/ProviderIcons.js';

type MergeProvider = 'kakao' | 'google';

/** 병합 콜백 실패(?mergeError=..) → 안내 문구. 백엔드 handleSocialCallback과 짝. */
function parseMergeError(t: Translator, search: string): string | null {
  const e = new URLSearchParams(search).get('mergeError');
  if (!e) return null;
  if (e === 'notfound') {
    return t('onboarding.mergeErrorNotfound');
  }
  if (e === 'conflict') {
    return t('onboarding.mergeErrorConflict');
  }
  return t('onboarding.mergeErrorGeneric');
}

export function OnboardingScreen() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [patientDisplayName, setPatientDisplayName] = useState('');
  const [patientModePin, setPatientModePin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mergeBusy, setMergeBusy] = useState<MergeProvider | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(() =>
    parseMergeError(t, window.location.search),
  );

  // 병합 실패 배너를 띄웠으면 URL의 쿼리를 지운다(새로고침 시 재노출 방지).
  useEffect(() => {
    if (mergeNotice) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [mergeNotice]);

  // "기존 계정에 연결": 병합 시작 코드를 받아 그 provider 로그인으로 이동한다.
  // 콜백이 이 계정(빈 신규)을 로그인한 기존 계정에 흡수시키고, 그 계정으로 로그인시킨다.
  const startMerge = async (provider: MergeProvider): Promise<void> => {
    setError(null);
    setMergeNotice(null);
    setMergeBusy(provider);
    try {
      // 병합 의도를 httpOnly 쿠키로 심는다(CSRF 방어). withCredentials 필수.
      await memoryLinkApi.post('/auth/merge/start', {}, { withCredentials: true });
      window.location.href = `${API_BASE_URL}/auth/${provider}/link`;
    } catch {
      setMergeBusy(null);
      setError(t('onboarding.mergeStartFailed'));
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    // 더블클릭/엔터 연타로 두 번 제출되면 환자 레코드가 중복 생성될 수 있다.
    // 버튼 disable은 리렌더 뒤에나 걸리므로, 핸들러 진입에서 먼저 막는다.
    if (isSubmitting) return;
    setError(null);

    if (patientDisplayName.trim().length === 0) {
      setError(t('patientField.errorNameRequired'));
      return;
    }
    if (!/^[0-9]{4}$/.test(patientModePin)) {
      setError(t('onboarding.errorPinInvalid'));
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
      setError(t('onboarding.saveFailed'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6">
        <h1 className="text-xl font-bold text-ink">
          {user?.displayName
            ? t('onboarding.greetingNamed', { name: user.displayName })
            : t('onboarding.greetingBare')}
        </h1>
        <p className="mt-1 mb-5 text-sm text-muted-sage">
          {t('onboarding.subtitle')}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="ob-patient-name"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('patientField.nameLabel')}
            </label>
            <input
              id="ob-patient-name"
              type="text"
              value={patientDisplayName}
              onChange={(e) => setPatientDisplayName(e.target.value)}
              className="w-full min-h-[48px] px-3 py-2 border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder={t('patientField.namePlaceholder')}
            />
          </div>

          <div>
            <label
              htmlFor="ob-pin"
              className="block text-sm font-medium text-ink mb-1"
            >
              {t('patientField.pinLabel')}
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
              className="w-full min-h-[48px] px-3 py-2 border border-line rounded-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="••••"
            />
            <p className="mt-1 text-xs text-muted-sage">
              {t('onboarding.patientPinHint')}
            </p>
          </div>

          {error !== null && (
            <p
              role="alert"
              className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[48px] py-2 px-4 bg-primary text-white font-medium rounded-full hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? t('onboarding.submitBusy') : t('onboarding.submit')}
          </button>
        </form>

        {/* 이미 다른 방법으로 가입한 계정이 있으면, 새로 만들지 말고 그 계정에 흡수 */}
        <div className="mt-6 border-t border-line pt-5">
          <p className="text-sm font-medium text-ink">
            {t('onboarding.mergeSectionTitle')}
          </p>
          <p className="mt-1 mb-3 text-xs text-muted-sage">
            {t('onboarding.mergeSectionSub')}
          </p>

          {mergeNotice !== null && (
            <p
              role="alert"
              className="mb-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink"
            >
              {mergeNotice}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void startMerge('kakao')}
              disabled={mergeBusy !== null}
              className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-full bg-[#FEE500] text-sm font-medium text-[#191600] transition-colors hover:bg-[#f5dc00] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <KakaoIcon className="h-4 w-4" />
              {mergeBusy === 'kakao' ? t('onboarding.mergeBusy') : t('onboarding.mergeKakao')}
            </button>
            <button
              type="button"
              onClick={() => void startMerge('google')}
              disabled={mergeBusy !== null}
              className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-full border border-[#DADCE0] bg-white text-sm font-medium text-[#3C4043] transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleIcon className="h-4 w-4" />
              {mergeBusy === 'google' ? t('onboarding.mergeBusy') : t('onboarding.mergeGoogle')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
