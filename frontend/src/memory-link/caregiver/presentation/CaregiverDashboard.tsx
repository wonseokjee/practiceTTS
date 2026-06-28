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
import { WARM_SCREEN_BG } from '../../shared/theme.js';

/** 대시보드 화면 상태 */
type DashboardView = 'list' | 'capture' | 'detail' | 'profile';

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
  };

  // patientId 미연결 안내
  if (!patientId) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: WARM_SCREEN_BG }}
      >
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
    <div className="min-h-screen" style={{ background: WARM_SCREEN_BG }}>
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
        {/* 오늘의 치유 메시지 (Pattern 2) — 목록 화면에서만 노출 */}
        {view === 'list' && <DailyHealingBanner />}

        {/* 발화 검사 회복 추세 (데이터 있을 때만 표시) */}
        {view === 'list' && <QabProgressCard />}

        {/* 목록 화면 */}
        {view === 'list' && (
          <EntryListScreen
            memoryEntries={memoryEntries}
            onSelectEntry={handleSelectEntry}
            onAddNew={handleAddNew}
          />
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
