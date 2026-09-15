/**
 * 설정 허브 — 카드 메뉴에서 세부 화면으로 이동한다.
 *
 * "설정"을 열면 카드 목록(환자 정보 / 계정 / 로그아웃)이 뜨고, 카드를 누르면
 * 그 화면으로 이동한다. 세부 화면의 "← 설정"으로 메뉴로 돌아온다.
 * 소셜 연결 복귀(accountNotice)면 계정 화면으로 바로 진입한다.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../shared/AuthContext.js';
import { ProfileScreen } from './ProfileScreen.js';
import { AccountLinkScreen } from './AccountLinkScreen.js';
import { SpeechConsentScreen } from './SpeechConsentScreen.js';
import type { AccountLinkNotice } from './AccountLinkScreen.js';

type Section = 'menu' | 'patient' | 'account' | 'speech';

interface SettingsScreenProps {
  /** 설정 메뉴에서 대시보드 목록으로 돌아가기. */
  onBack: () => void;
  /** 계정 화면의 ?linked/?linkError 복귀 배너. 있으면 계정 화면으로 바로 진입. */
  accountNotice?: AccountLinkNotice | null;
}

export function SettingsScreen({ onBack, accountNotice }: SettingsScreenProps) {
  const { t } = useTranslation('caregiver');
  const { logout } = useAuth();
  // 소셜 연결 복귀면 계정 화면으로 바로 들어가 결과 배너를 보여준다.
  const [section, setSection] = useState<Section>(
    accountNotice ? 'account' : 'menu',
  );

  if (section === 'patient') {
    return (
      <ProfileScreen onBack={() => setSection('menu')} backLabel={t('settings.title')} />
    );
  }
  if (section === 'account') {
    return (
      <AccountLinkScreen
        onBack={() => setSection('menu')}
        backLabel={t('settings.title')}
        notice={accountNotice}
      />
    );
  }
  if (section === 'speech') {
    return <SpeechConsentScreen onBack={() => setSection('menu')} backLabel={t('settings.title')} />;
  }

  return (
    <div className="font-pretendard mx-auto w-full max-w-lg">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm text-muted-sage transition-colors hover:text-primary"
        aria-label={t('settings.backToListAria')}
      >
        {t('settings.backToList')}
      </button>

      <header className="mb-6">
        <h2 className="text-2xl font-bold text-primary">{t('settings.title')}</h2>
      </header>

      <div className="flex flex-col gap-3">
        <SettingCard
          title={t('settings.patientInfoTitle')}
          description={t('settings.patientInfoDesc')}
          onClick={() => setSection('patient')}
        />
        <SettingCard
          title={t('settings.accountTitle')}
          description={t('settings.accountDesc')}
          onClick={() => setSection('account')}
        />
        <SettingCard
          title={t('settings.speechTitle')}
          description={t('settings.speechDesc')}
          onClick={() => setSection('speech')}
        />
        <SettingCard title={t('settings.logout')} onClick={logout} danger />
      </div>

      {/* 오픈소스 그림 출처 — 단어이해 픽토그램에 Microsoft Fluent Emoji(MIT) 사용.
          MIT는 앱 내 표기 의무가 없으나(라이선스 고지는 저장소 NOTICE로 충족),
          출처를 밝히는 것은 예의라 가볍게 노출한다. */}
      <footer className="mt-8 border-t border-line pt-4 text-center text-xs text-muted-sage">
        {t('settings.footerCredit')}{' '}
        <a
          href="https://github.com/microsoft/fluentui-emoji"
          target="_blank"
          rel="noreferrer"
          className="underline transition-colors hover:text-primary"
        >
          Fluent Emoji
        </a>
        {' · MIT'}
      </footer>
    </div>
  );
}

// ─── 설정 카드 ─────────────────────────────────────────────────

interface SettingCardProps {
  title: string;
  description?: string;
  onClick: () => void;
  /** 로그아웃 등 이탈 액션이면 붉은 톤으로. */
  danger?: boolean;
}

function SettingCard({ title, description, onClick, danger }: SettingCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[64px] w-full items-center justify-between rounded-2xl border bg-white px-5 py-4 text-left transition-colors duration-[180ms] ease-out ${
        danger
          ? 'border-danger/25 hover:bg-danger-soft'
          : 'border-line hover:bg-canvas'
      }`}
    >
      <span>
        <span
          className={`block text-base font-medium ${
            danger ? 'text-danger-ink' : 'text-ink-sage'
          }`}
        >
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-muted-sage">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`text-lg ${danger ? 'text-danger/50' : 'text-[#B7BDB8]'}`}
      >
        ›
      </span>
    </button>
  );
}
