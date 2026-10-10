import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { Translator } from '../../../shared/i18n/i18n.js';
import { useAuth } from '../../shared/AuthContext.js';
import { DailyHealingBanner } from '../../shared/components/DailyHealingBanner.js';
import { useCaptureFlow } from '../application/useCaptureFlow.js';
import { useMemoryEntries } from '../application/useMemoryEntries.js';
import type { AccountLinkNotice } from './AccountLinkScreen.js';
import { CaptureScreen } from './CaptureScreen.js';
import { EntryDetailScreen } from './EntryDetailScreen.js';
import { EntryListScreen } from './EntryListScreen.js';
import { SettingsScreen } from './SettingsScreen.js';
import { QabProgressCard } from './QabProgressCard.js';
import { SessionCompletionCard } from './SessionCompletionCard.js';
import { PracticeSummaryCard } from './PracticeSummaryCard.js';
import { SkillLevelCard } from './SkillLevelCard.js';
import { WeeklyReportScreen } from './WeeklyReportScreen.js';
import { withHonorific, ELDER_HONORIFIC } from '../../shared/honorific.js';
import { isConversationModeEnabled } from '../../shared/featureFlags.js';

/** 대시보드 화면 상태 */
type DashboardView = 'list' | 'capture' | 'detail' | 'report' | 'settings';

/**
 * 소셜 계정 연결 콜백 복귀(/caregiver?linked=..|?linkError=..)를 배너 알림으로.
 * 백엔드 handleSocialCallback이 리다이렉트에 실어 보내는 값과 짝을 맞춘다.
 */
function parseLinkNotice(
  t: Translator,
  search: string,
): AccountLinkNotice | null {
  const params = new URLSearchParams(search);
  const linked = params.get('linked');
  if (linked === 'kakao' || linked === 'google') {
    const provider = t(
      linked === 'kakao' ? 'accountLink.providerKakao' : 'accountLink.providerGoogle',
    );
    return { kind: 'success', text: t('dashboard.linkSuccess', { provider }) };
  }
  const err = params.get('linkError');
  if (err) {
    const text =
      err === 'conflict'
        ? t('dashboard.linkErrorConflict')
        : err === 'state' || err === 'expired'
          ? t('dashboard.linkErrorExpired')
          : t('dashboard.linkErrorGeneric');
    return { kind: 'error', text };
  }
  return null;
}

/**
 * 보호자 대시보드
 * - EntryListScreen (목록) ↔ CaptureScreen (생성) ↔ EntryDetailScreen (상세) 전환
 * - useMemoryEntries: 목록 조회 및 시나리오 트리거
 * - useCaptureFlow: 3단계 생성 플로우
 */
export function CaregiverDashboard() {
  const { t } = useTranslation('caregiver');
  const { user, logout, enterPatientMode } = useAuth();
  const [view, setView] = useState<DashboardView>('list');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<AccountLinkNotice | null>(
    null,
  );

  const memoryEntries = useMemoryEntries();

  // 소셜 연결 콜백 복귀(?linked/?linkError) 감지 → 설정 화면 + 배너로 안내하고,
  // URL의 쿼리는 지운다(새로고침·뒤로가기 시 배너가 다시 뜨지 않게).
  // 배너가 있으면 SettingsScreen이 계정 섹션으로 스크롤한다.
  useEffect(() => {
    const notice = parseLinkNotice(t, window.location.search);
    if (!notice) return;
    setAccountNotice(notice);
    setView('settings');
    window.history.replaceState(null, '', window.location.pathname);
    // URL 쿼리는 마운트 시 1회만 읽으면 된다 — t는 의존성에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // patientId가 없는 보호자는 기능 사용 불가
  const patientId = user?.patientId ?? null;

  const captureFlow = useCaptureFlow(patientId ?? '');

  const handleSelectEntry = (id: string) => {
    setSelectedEntryId(id);
    setView('detail');
  };

  const handleAddNew = () => {
    captureFlow.reset();
    setView('capture');
  };

  const handleCaptureComplete = () => {
    void memoryEntries.refresh();
    setView('list');
  };

  const handleCaptureCancel = () => {
    captureFlow.reset();
    setView('list');
  };

  const handleBackToList = () => {
    setSelectedEntryId(null);
    setView('list');
    // 상세에서 목표 단어를 저장하거나 시나리오를 만들고 나왔을 수 있다.
    // 다시 불러오지 않으면 목록이 옛 상태를 그대로 보여준다 — 방금 단어를
    // 등록했는데도 "목표 단어를 등록해 주세요"가 남아 있어, 보호자가 저장이
    // 안 됐다고 오해한다(실제로 그렇게 보였다).
    void memoryEntries.refresh();
  };

  // 상단 요약 통계 — 실제 데이터만 사용(오늘 훈련 횟수·회복 추세 화살표는 API 부재).
  const entries = memoryEntries.entries;
  const readyCount = entries.filter((entry) => entry.hasScenario).length;
  // 보호자가 손대야 진행되는 기억. 분석은 끝났는데 시나리오가 없는 것들이다.
  // (분석 중인 건 기다리면 되므로 세지 않는다 — 재촉할 대상이 아니다.)
  // 대화를 감췄으면 재촉할 이유가 없다(시나리오는 대화 전용이다).
  const needsSetupCount = isConversationModeEnabled()
    ? entries.filter((entry) => !entry.hasScenario && entry.hasMaskedContext)
        .length
    : 0;

  // patientId 미연결 안내
  if (!patientId) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-lg bg-white rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.08)] p-8 text-center">
          <h1 className="text-2xl font-bold text-ink mb-2">{t('dashboard.title')}</h1>
          <p className="text-muted-sage mb-4">
            <Trans
              t={t}
              i18nKey="dashboard.greeting"
              values={{ name: user?.displayName }}
              components={{ b: <span className="font-medium text-ink" /> }}
            />
          </p>
          <p className="text-sm text-[#8a5a1a] bg-warning/12 border border-warning/35 rounded-2xl p-3 mb-6">
            {t('dashboard.noPatientMessage')}
          </p>
          <button
            type="button"
            onClick={logout}
            className="min-h-[44px] px-6 py-2 bg-primary-light text-primary rounded-full hover:bg-[#dcebe4] transition-colors text-sm font-medium"
          >
            {t('settings.logout')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* 헤더 */}
      <header className="border-b border-line/60 px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-bold text-ink">Memory Link</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setAccountNotice(null);
              setView('settings');
            }}
            className="min-h-[44px] rounded-full border border-primary px-4 py-2 text-sm font-medium text-primary transition-colors duration-[180ms] ease-out hover:bg-primary-light"
            aria-label={t('dashboard.settingsAria')}
          >
            {t('settings.title')}
          </button>
          <button
            type="button"
            onClick={enterPatientMode}
            className="min-h-[44px] rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark"
            aria-label={t('dashboard.handOverAria')}
          >
            {t('dashboard.handOverButton')}
          </button>
          <span className="hidden text-sm text-muted-sage sm:inline">
            {user?.displayName}
          </span>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* 목록 화면 — 시안 A: 환자 요약 → 통계 → 추가 → 회복 추세 → 기억 그리드 */}
        {view === 'list' && (
          <>
            {/* 환자 인사 */}
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-ink">
                {withHonorific(user?.patientDisplayName, ELDER_HONORIFIC)}
              </h2>
              <p className="mt-1 text-sm text-muted-sage">{t('dashboard.patientGreetingSub')}</p>
            </div>

            {/* 요약 통계 카드 */}
            <div className="mb-4 flex gap-3">
              <StatCard
                label={t('dashboard.statMemories')}
                value={`${entries.length}`}
                unit={t('dashboard.statMemoriesUnit') || undefined}
              />
              {isConversationModeEnabled() && (
                <StatCard
                  label={t('dashboard.statReady')}
                  value={`${readyCount}`}
                  unit={`/ ${entries.length}`}
                />
              )}
            </div>

            {/* 대화가 막혀 있으면 무엇을 해야 하는지 알린다.
                환자 화면은 '보호자가 준비 중이에요'만 보여주므로, 여기서
                말하지 않으면 양쪽이 서로를 기다리는 교착이 된다. */}
            {needsSetupCount > 0 && (
              <div
                className="mb-4 rounded-2xl border border-accent/30 bg-accent/8 p-3"
                role="status"
              >
                <p className="text-sm font-medium text-accent-ink">
                  {t('dashboard.needsSetupTitle')}
                </p>
                <p className="mt-1 text-xs text-muted-sage">
                  {t('dashboard.needsSetupBody', { count: needsSetupCount })}
                </p>
              </div>
            )}

            {/* 오늘의 기억 추가 (히어로 액션) */}
            <button
              type="button"
              onClick={handleAddNew}
              className="mb-6 flex w-full min-h-[56px] items-center justify-center gap-2 rounded-full bg-accent-strong text-lg font-bold text-white shadow-[0_8px_20px_rgba(184,92,54,0.35)] transition hover:bg-accent-hover active:scale-[0.99]"
              aria-label={t('dashboard.addMemoryAria')}
            >
              {t('dashboard.addMemoryButton')}
            </button>

            {/* 오늘의 치유 메시지 (Pattern 2) */}
            <DailyHealingBanner />

            {/* 발화 검사 회복 추세 (데이터 있을 때만 표시) */}
            <QabProgressCard onOpenReport={() => setView('report')} />

            {/* 스킬별 연습 눈높이(적응 레벨) — 방향 카드 */}
            <SkillLevelCard />

            {/* 연습 마무리(완료율·이탈 지점) — 기록 있을 때만 표시 */}
            <SessionCompletionCard />

            {/* 가볍게 연습하기 — 한 양과 첫 시도 정답률(검사와 따로). 기록 있을 때만 */}
            <PracticeSummaryCard />

            {/* 기억 목록 그리드 */}
            <EntryListScreen
              memoryEntries={memoryEntries}
              onSelectEntry={handleSelectEntry}
            />
          </>
        )}

        {/* 생성 플로우 화면 */}
        {view === 'capture' && (
          <div>
            <h2 className="text-lg font-bold text-ink mb-4">{t('dashboard.newCaptureTitle')}</h2>
            <CaptureScreen
              patientId={patientId}
              flow={captureFlow}
              onComplete={handleCaptureComplete}
              onCancel={handleCaptureCancel}
            />
          </div>
        )}

        {/* 진료용 리포트 */}
        {view === 'report' && <WeeklyReportScreen onBack={handleBackToList} />}

        {/* 설정: 환자 정보 + 계정 연결 + 로그아웃 (세로 스택) */}
        {view === 'settings' && (
          <SettingsScreen
            onBack={handleBackToList}
            accountNotice={accountNotice}
          />
        )}

        {/* 상세 화면 */}
        {view === 'detail' && selectedEntryId && (
          <EntryDetailScreen
            entryId={selectedEntryId}
            scenarioStatus={
              memoryEntries.scenarioStatus[selectedEntryId] ?? 'idle'
            }
            scenarioNotice={memoryEntries.scenarioNotice[selectedEntryId]}
            onTriggerScenario={memoryEntries.triggerScenario}
            onBack={handleBackToList}
          />
        )}
      </main>
    </div>
  );
}

// ─── 요약 통계 카드 ──────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
}

/** 환자 상태 요약용 작은 통계 카드 (등록한 기억 / 훈련 준비 등) */
function StatCard({ label, value, unit }: StatCardProps) {
  return (
    <div className="flex-1 rounded-2xl border border-line bg-white p-3">
      <p className="text-xs text-muted-sage">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-primary">
        {value}
        {unit !== undefined && (
          <span className="ml-0.5 text-sm font-semibold text-muted-sage">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}
