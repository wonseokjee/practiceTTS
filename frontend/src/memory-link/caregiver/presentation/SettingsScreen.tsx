/**
 * 설정 허브 — 카드 메뉴에서 세부 화면으로 이동한다.
 *
 * "설정"을 열면 카드 목록(환자 정보 / 계정 / 로그아웃)이 뜨고, 카드를 누르면
 * 그 화면으로 이동한다. 세부 화면의 "← 설정"으로 메뉴로 돌아온다.
 * 소셜 연결 복귀(accountNotice)면 계정 화면으로 바로 진입한다.
 */

import { useState } from 'react';
import { useAuth } from '../../shared/AuthContext.js';
import { ProfileScreen } from './ProfileScreen.js';
import { AccountLinkScreen } from './AccountLinkScreen.js';
import type { AccountLinkNotice } from './AccountLinkScreen.js';

type Section = 'menu' | 'patient' | 'account';

interface SettingsScreenProps {
  /** 설정 메뉴에서 대시보드 목록으로 돌아가기. */
  onBack: () => void;
  /** 계정 화면의 ?linked/?linkError 복귀 배너. 있으면 계정 화면으로 바로 진입. */
  accountNotice?: AccountLinkNotice | null;
}

export function SettingsScreen({ onBack, accountNotice }: SettingsScreenProps) {
  const { logout } = useAuth();
  // 소셜 연결 복귀면 계정 화면으로 바로 들어가 결과 배너를 보여준다.
  const [section, setSection] = useState<Section>(
    accountNotice ? 'account' : 'menu',
  );

  if (section === 'patient') {
    return (
      <ProfileScreen onBack={() => setSection('menu')} backLabel="설정" />
    );
  }
  if (section === 'account') {
    return (
      <AccountLinkScreen
        onBack={() => setSection('menu')}
        backLabel="설정"
        notice={accountNotice}
      />
    );
  }

  return (
    <div className="font-pretendard mx-auto w-full max-w-lg">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm text-[#5C6661] transition-colors hover:text-[#2D6A56]"
        aria-label="목록으로 돌아가기"
      >
        ← 목록으로
      </button>

      <header className="mb-6">
        <h2 className="text-2xl font-bold text-[#2D6A56]">설정</h2>
      </header>

      <div className="flex flex-col gap-3">
        <SettingCard
          title="환자 정보"
          description="고향·직업·가족 등 어르신 정보 편집"
          onClick={() => setSection('patient')}
        />
        <SettingCard
          title="계정"
          description="카카오·구글 로그인 연결 관리"
          onClick={() => setSection('account')}
        />
        <SettingCard title="로그아웃" onClick={logout} danger />
      </div>
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
          ? 'border-[#C94040]/25 hover:bg-[#FEF0F0]'
          : 'border-[#E8E4DC] hover:bg-[#F7F6F3]'
      }`}
    >
      <span>
        <span
          className={`block text-base font-medium ${
            danger ? 'text-[#8b2020]' : 'text-[#1F2A26]'
          }`}
        >
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-[#6B6560]">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`text-lg ${danger ? 'text-[#C94040]/50' : 'text-[#B7BDB8]'}`}
      >
        ›
      </span>
    </button>
  );
}
