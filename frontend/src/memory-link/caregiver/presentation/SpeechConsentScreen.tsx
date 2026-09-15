/**
 * 음성 데이터 제공 동의 화면.
 *
 * 어르신의 발화는 발음 채점·받아쓰기 과정에서 서버로 올라가지만, 기본적으로
 * 채점이 끝나면 즉시 버려진다. 보호자가 여기서 **동의**하면 그때부터의 발화가
 * (정답 텍스트를 라벨로) 저장돼, 향후 어르신 맞춤 음성인식 모델 개선에 쓰인다.
 *
 * 동의는 언제든 끌 수 있고(이후 저장 중단), "삭제"로 이미 모인 음성을 전부
 * 지울 수 있다. — GET/PUT /speech-data/consent, DELETE /speech-data
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { memoryLinkApi } from '../../shared/MemoryLinkApi.js';
import { formatDate } from '../../../shared/i18n/formatDate.js';

interface ConsentState {
  consent: boolean;
  consentAt: string | null;
  count: number;
}

interface SpeechConsentScreenProps {
  onBack: () => void;
  backLabel?: string;
}

export function SpeechConsentScreen({
  onBack,
  backLabel,
}: SpeechConsentScreenProps) {
  const { t } = useTranslation('caregiver');
  const label = backLabel ?? t('settings.title');
  const [state, setState] = useState<ConsentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await memoryLinkApi.get<ConsentState>(
        '/speech-data/consent',
      );
      setState(data);
    } catch {
      setError(t('speechConsent.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleConsent = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      try {
        await memoryLinkApi.put('/speech-data/consent', { consent: next });
        await load();
      } catch {
        setError(t('speechConsent.errorToggle'));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  const deleteAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await memoryLinkApi.delete('/speech-data');
      setConfirmDelete(false);
      await load();
    } catch {
      setError(t('speechConsent.errorDelete'));
    } finally {
      setBusy(false);
    }
  }, [load, t]);

  const consent = state?.consent ?? false;
  const count = state?.count ?? 0;

  return (
    <div className="font-pretendard mx-auto w-full max-w-lg">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm text-muted-sage transition-colors hover:text-primary"
        aria-label={t('nav.backAria', { label })}
      >
        ← {label}
      </button>

      <header className="mb-6">
        <h2 className="text-2xl font-bold text-primary">{t('speechConsent.title')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-sage">
          {t('speechConsent.description')}
        </p>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-line bg-white px-5 py-8 text-center text-sm text-muted-sage">
          {t('speechConsent.loading')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 동의 토글 */}
          <div className="flex items-center justify-between rounded-2xl border border-line bg-white px-5 py-4">
            <span>
              <span className="block text-base font-medium text-ink-sage">
                {t('speechConsent.consentToggleLabel')}
              </span>
              <span className="mt-0.5 block text-xs text-muted-sage">
                {consent
                  ? state?.consentAt
                    ? t('speechConsent.consentStatusSince', { date: formatDate(state.consentAt) })
                    : t('speechConsent.consentStatusOn')
                  : t('speechConsent.consentStatusOff')}
              </span>
            </span>
            <ConsentToggle
              on={consent}
              disabled={busy}
              onChange={(next) => void toggleConsent(next)}
            />
          </div>

          {/* 저장 건수 + 삭제 */}
          <div className="rounded-2xl border border-line bg-white px-5 py-4">
            <div className="flex items-center justify-between">
              <span>
                <span className="block text-base font-medium text-ink-sage">
                  {t('speechConsent.storedTitle')}
                </span>
                <span className="mt-0.5 block text-xs text-muted-sage tabular-nums">
                  {t('speechConsent.storedCount', { count })}
                </span>
              </span>
              {count > 0 && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                  className="rounded-lg border border-danger/25 px-3 py-1.5 text-sm text-danger-ink transition-colors hover:bg-danger-soft disabled:opacity-50"
                >
                  {t('speechConsent.deleteAll')}
                </button>
              )}
            </div>

            {confirmDelete && (
              <div className="mt-4 rounded-xl bg-danger-soft px-4 py-3">
                <p className="text-sm text-danger-ink">
                  {t('speechConsent.confirmDeleteText', { count })}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void deleteAll()}
                    disabled={busy}
                    className="rounded-lg bg-danger px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#b23636] disabled:opacity-50"
                  >
                    {t('speechConsent.confirmDeleteConfirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy}
                    className="rounded-lg border border-line px-4 py-1.5 text-sm text-muted-sage transition-colors hover:bg-canvas disabled:opacity-50"
                  >
                    {t('speechConsent.confirmDeleteCancel')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="px-1 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 동의 토글 스위치 ─────────────────────────────────────────────

interface ConsentToggleProps {
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

function ConsentToggle({ on, disabled, onChange }: ConsentToggleProps) {
  const { t } = useTranslation('caregiver');
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t('speechConsent.consentSwitchAria')}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-[180ms] ease-out disabled:opacity-50 ${
        on ? 'bg-primary' : 'bg-[#D5D1C8]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-[180ms] ease-out ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
