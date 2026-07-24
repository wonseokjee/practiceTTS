import { useState } from 'react';
import { useAuth } from '../../shared/AuthContext.js';
import { DailyHealingBanner } from '../../shared/components/DailyHealingBanner.js';
import { useCaptureFlow } from '../application/useCaptureFlow.js';
import { useMemoryEntries } from '../application/useMemoryEntries.js';
import { CaptureScreen } from './CaptureScreen.js';
import { EntryDetailScreen } from './EntryDetailScreen.js';
import { EntryListScreen } from './EntryListScreen.js';
import { ProfileScreen } from './ProfileScreen.js';
import { QabProgressCard } from './QabProgressCard.js';
import { WeeklyReportScreen } from './WeeklyReportScreen.js';
import { withHonorific } from '../../shared/honorific.js';
import { isConversationModeEnabled } from '../../shared/featureFlags.js';

/** 대시보드 화면 상태 */
type DashboardView = 'list' | 'capture' | 'detail' | 'profile' | 'report';

/**
 * 보호자 대시보드
 * - EntryListScreen (목록) ↔ CaptureScreen (생성) ↔ EntryDetailScreen (상세) 전환
 * - useMemoryEntries: 목록 조회 및 시나리오 트리거
 * - useCaptureFlow: 3단계 생성 플로우
 */
export function CaregiverDashboard() {
  const { user, logout, enterPatientMode } = useAuth();
  const [view, setView] = useState<DashboardView>('list');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const memoryEntries = useMemoryEntries();

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
      <div className="min-h-screen bg-[#F7F6F3] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-lg bg-white rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.08)] p-8 text-center">
          <h1 className="text-2xl font-bold text-[#1A1916] mb-2">보호자 대시보드</h1>
          <p className="text-[#6B6560] mb-4">
            안녕하세요,{' '}
            <span className="font-medium text-[#1A1916]">{user?.displayName}</span>님
          </p>
          <p className="text-sm text-[#8a5a1a] bg-[#E8A23C]/12 border border-[#E8A23C]/35 rounded-2xl p-3 mb-6">
            연결된 환자가 없습니다. 관리자에게 환자 연결을 요청해주세요.
          </p>
          <button
            type="button"
            onClick={logout}
            className="min-h-[44px] px-6 py-2 bg-[#EBF4F0] text-[#2D6A56] rounded-full hover:bg-[#dcebe4] transition-colors text-sm font-medium"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F6F3]">
      {/* 헤더 */}
      <header className="border-b border-[#E8E4DC]/60 px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-bold text-[#1A1916]">Memory Link</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setView('profile')}
            className="min-h-[44px] rounded-full border border-[#2D6A56] px-4 py-2 text-sm font-medium text-[#2D6A56] transition-colors duration-[180ms] ease-out hover:bg-[#EBF4F0]"
            aria-label="환자 정보 편집"
          >
            환자 정보
          </button>
          <button
            type="button"
            onClick={enterPatientMode}
            className="min-h-[44px] rounded-full bg-[#2D6A56] px-4 py-2 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
            aria-label="환자에게 기기 건네기 (환자 모드로 전환)"
          >
            환자에게 건네기
          </button>
          <span className="hidden text-sm text-[#6B6560] sm:inline">
            {user?.displayName}
          </span>
          <button
            type="button"
            onClick={logout}
            className="text-xs text-[#9AA09B] hover:text-[#6B6560] transition-colors"
            aria-label="로그아웃"
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* 목록 화면 — 시안 A: 환자 요약 → 통계 → 추가 → 회복 추세 → 기억 그리드 */}
        {view === 'list' && (
          <>
            {/* 환자 인사 */}
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-[#1A1916]">
                {withHonorific(user?.patientDisplayName, '어르신')}
              </h2>
              <p className="mt-1 text-sm text-[#6B6560]">오늘도 함께해요</p>
            </div>

            {/* 요약 통계 카드 */}
            <div className="mb-4 flex gap-3">
              <StatCard label="등록한 기억" value={`${entries.length}`} unit="개" />
              {isConversationModeEnabled() && (
                <StatCard
                  label="훈련 준비"
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
                className="mb-4 rounded-2xl border border-[#E07B54]/30 bg-[#E07B54]/8 p-3"
                role="status"
              >
                <p className="text-sm font-medium text-[#7A2E15]">
                  대화를 시작하려면 준비가 조금 더 필요해요
                </p>
                <p className="mt-1 text-xs text-[#6B6560]">
                  기억 {needsSetupCount}개가 목표 단어 등록과 시나리오 생성을
                  기다리고 있어요. 아래 목록에서 기억을 눌러 이어서 준비해
                  주세요.
                </p>
              </div>
            )}

            {/* 오늘의 기억 추가 (히어로 액션) */}
            <button
              type="button"
              onClick={handleAddNew}
              className="mb-6 flex w-full min-h-[56px] items-center justify-center gap-2 rounded-full bg-[#E07B54] text-lg font-bold text-white shadow-[0_8px_20px_rgba(224,123,84,0.35)] transition hover:bg-[#c96a45] active:scale-[0.99]"
              aria-label="오늘의 기억 추가"
            >
              ＋ 오늘의 기억 추가
            </button>

            {/* 오늘의 치유 메시지 (Pattern 2) */}
            <DailyHealingBanner />

            {/* 발화 검사 회복 추세 (데이터 있을 때만 표시) */}
            <QabProgressCard onOpenReport={() => setView('report')} />

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
            <h2 className="text-lg font-bold text-[#1A1916] mb-4">새 기억 추가</h2>
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

        {/* 환자 정보(프로필) 화면 */}
        {view === 'profile' && (
          <ProfileScreen onBack={handleBackToList} />
        )}

        {/* 상세 화면 */}
        {view === 'detail' && selectedEntryId && (
          <EntryDetailScreen
            entryId={selectedEntryId}
            scenarioStatus={
              memoryEntries.scenarioStatus[selectedEntryId] ?? 'idle'
            }
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
    <div className="flex-1 rounded-2xl border border-[#E8E4DC] bg-white p-3">
      <p className="text-xs text-[#6B6560]">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-[#2D6A56]">
        {value}
        {unit !== undefined && (
          <span className="ml-0.5 text-sm font-semibold text-[#6B6560]">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}
