import { useState } from 'react';
import { useAuth } from '../../shared/AuthContext.js';
import { useCaptureFlow } from '../application/useCaptureFlow.js';
import { useMemoryEntries } from '../application/useMemoryEntries.js';
import { CaptureScreen } from './CaptureScreen.js';
import { EntryDetailScreen } from './EntryDetailScreen.js';
import { EntryListScreen } from './EntryListScreen.js';

/** 대시보드 화면 상태 */
type DashboardView = 'list' | 'capture' | 'detail';

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
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-md p-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">보호자 대시보드</h1>
          <p className="text-gray-500 mb-4">
            안녕하세요,{' '}
            <span className="font-medium text-gray-700">{user?.displayName}</span>님
          </p>
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6">
            연결된 환자가 없습니다. 관리자에게 환자 연결을 요청해주세요.
          </p>
          <button
            type="button"
            onClick={logout}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-bold text-gray-900">Memory Link</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={enterPatientMode}
            className="min-h-[44px] rounded-full bg-[#2D6A56] px-4 py-2 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
            aria-label="환자에게 기기 건네기 (환자 모드로 전환)"
          >
            환자에게 건네기
          </button>
          <span className="hidden text-sm text-gray-600 sm:inline">
            {user?.displayName}
          </span>
          <button
            type="button"
            onClick={logout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="로그아웃"
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-2xl mx-auto px-4 py-6">
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
            <h2 className="text-lg font-bold text-gray-900 mb-4">새 기억 추가</h2>
            <CaptureScreen
              patientId={patientId}
              flow={captureFlow}
              onComplete={handleCaptureComplete}
              onCancel={handleCaptureCancel}
            />
          </div>
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
