import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../shared/AuthContext.js';
import { trainingSessionApi } from '../infrastructure/TrainingSessionApi.js';
import type { AvailableEntry } from '../domain/TrainingSession.js';
import { TrainingScreen } from './TrainingScreen.js';

/** 환자 대시보드 화면 단계 */
type DashboardPhase = 'LIST' | 'TRAINING';

/** 선택된 훈련 정보 */
interface SelectedTraining {
  memoryEntryId: string;
  targetWord: string;
}

/**
 * 환자 대시보드
 *
 * - 훈련 가능한 메모리 엔트리 목록 표시
 * - 시나리오가 준비된 항목에 "훈련 시작" 버튼
 * - 훈련 시작 클릭 시 TrainingScreen으로 전환
 */
export function PatientDashboard() {
  const { user, logout } = useAuth();

  const [phase, setPhase] = useState<DashboardPhase>('LIST');
  const [selectedTraining, setSelectedTraining] = useState<SelectedTraining | null>(null);
  const [entries, setEntries] = useState<AvailableEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  /** 훈련 가능 엔트리 목록 조회 */
  const loadEntries = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await trainingSessionApi.getAvailableEntries();
      setEntries(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  /** "훈련 시작" 버튼 핸들러 */
  const handleStartTraining = useCallback(
    (entry: AvailableEntry, targetWord: string) => {
      setSelectedTraining({ memoryEntryId: entry.id, targetWord });
      setPhase('TRAINING');
    },
    [],
  );

  /** 훈련 완료 후 목록으로 복귀 */
  const handleTrainingComplete = useCallback(() => {
    setSelectedTraining(null);
    setPhase('LIST');
    void loadEntries();
  }, [loadEntries]);

  // 훈련 화면
  if (phase === 'TRAINING' && selectedTraining !== null) {
    return (
      <TrainingScreen
        memoryEntryId={selectedTraining.memoryEntryId}
        targetWord={selectedTraining.targetWord}
        onComplete={handleTrainingComplete}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">안녕하세요</h1>
          <p className="text-xl text-gray-600 mt-1">
            {user?.displayName}님, 오늘도 함께 훈련해요!
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="min-h-[48px] px-5 py-2 bg-gray-100 text-gray-700 text-lg font-medium rounded-xl"
          aria-label="로그아웃"
        >
          로그아웃
        </button>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="px-6 py-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">
          훈련 목록
        </h2>

        {/* 로딩 상태 */}
        {isLoading && (
          <div className="flex items-center justify-center py-16" role="status">
            <p className="text-2xl text-gray-500">불러오는 중...</p>
          </div>
        )}

        {/* 에러 상태 */}
        {!isLoading && error !== null && (
          <div className="py-8 text-center" role="alert">
            <p className="text-xl text-red-600 mb-4">{error}</p>
            <button
              type="button"
              onClick={() => void loadEntries()}
              className="min-h-[48px] px-8 py-3 bg-blue-600 text-white text-xl font-semibold rounded-2xl"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* 엔트리 없음 */}
        {!isLoading && error === null && entries.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-2xl text-gray-500">
              아직 등록된 훈련이 없습니다.
            </p>
            <p className="text-xl text-gray-400 mt-2">
              보호자가 기억 카드를 등록하면 훈련을 시작할 수 있어요.
            </p>
          </div>
        )}

        {/* 엔트리 목록 */}
        {!isLoading && error === null && entries.length > 0 && (
          <ul className="flex flex-col gap-4" role="list" aria-label="훈련 가능 항목 목록">
            {entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onStartTraining={handleStartTraining}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

// ─── 보조 컴포넌트 ──────────────────────────────────────────────────────────

interface EntryCardProps {
  entry: AvailableEntry;
  onStartTraining: (entry: AvailableEntry, targetWord: string) => void;
}

function EntryCard({ entry, onStartTraining }: EntryCardProps) {
  const [selectedWord, setSelectedWord] = useState<string>(
    entry.targetWords[0] ?? '',
  );

  return (
    <li className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex gap-4 p-4">
        {/* 사진 썸네일 */}
        {entry.photoUrl !== null && (
          <img
            src={entry.photoUrl}
            alt="기억 사진"
            className="w-24 h-24 object-cover rounded-xl flex-shrink-0"
          />
        )}

        {/* 엔트리 정보 */}
        <div className="flex-1 flex flex-col gap-2">
          {/* 장소 태그 */}
          {entry.locationTag !== null && (
            <p className="text-xl text-gray-700">
              장소: <span className="font-semibold">{entry.locationTag}</span>
            </p>
          )}

          {/* 감정 태그 */}
          {entry.emotionTag !== null && (
            <p className="text-lg text-gray-500">{entry.emotionTag}</p>
          )}

          {/* 목표 단어 선택 (여러 개인 경우) */}
          {entry.targetWords.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="text-lg text-gray-600">연습할 단어 선택:</p>
              <div className="flex gap-2 flex-wrap">
                {entry.targetWords.map((word) => (
                  <button
                    key={word}
                    type="button"
                    onClick={() => setSelectedWord(word)}
                    className={`min-h-[40px] px-4 py-2 rounded-xl text-lg font-medium transition-colors ${
                      selectedWord === word
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {word}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 단어가 1개인 경우 표시만 */}
          {entry.targetWords.length === 1 && (
            <p className="text-xl text-gray-700">
              연습 단어: <span className="font-bold text-blue-700">{entry.targetWords[0]}</span>
            </p>
          )}
        </div>
      </div>

      {/* 훈련 시작 버튼 영역 */}
      <div className="px-4 pb-4">
        {entry.hasScenario ? (
          <button
            type="button"
            onClick={() => onStartTraining(entry, selectedWord)}
            disabled={selectedWord === ''}
            className="w-full min-h-[56px] bg-blue-600 text-white text-2xl font-bold rounded-2xl disabled:opacity-50 active:scale-[0.98] transition-transform"
            aria-label={`${entry.locationTag ?? '기억'} 훈련 시작`}
          >
            훈련 시작
          </button>
        ) : (
          <div className="w-full min-h-[56px] flex items-center justify-center bg-gray-100 rounded-2xl">
            <p className="text-xl text-gray-500">보호자가 준비 중이에요</p>
          </div>
        )}
      </div>
    </li>
  );
}

/** Axios 에러에서 메시지를 안전하게 추출 */
function extractErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (
      typeof obj.response === 'object' &&
      obj.response !== null &&
      typeof (obj.response as Record<string, unknown>).data === 'object'
    ) {
      const data = (obj.response as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      if (typeof data.message === 'string') return data.message;
    }
    if (err instanceof Error) return err.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}
