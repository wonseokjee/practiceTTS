import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/AuthContext.js';
import { DailyHealingBanner } from '../../shared/components/DailyHealingBanner.js';
import { ReturnToCaregiverPinModal } from '../../shared/ReturnToCaregiverPinModal.js';
import { trainingSessionApi } from '../infrastructure/TrainingSessionApi.js';
import type { AvailableEntry } from '../domain/TrainingSession.js';
import { TrainingScreen } from './TrainingScreen.js';
import { QuizListScreen } from '../quiz/presentation/QuizListScreen.js';
import { QuizScreen } from '../quiz/presentation/QuizScreen.js';
import { extractErrorMessage } from '../../shared/extractErrorMessage.js';
import { WARM_SCREEN_BG } from '../../shared/theme.js';

/** 환자 학습 모드 (R9-a: localStorage에 마지막 모드 저장/복원) */
type PatientMode = 'QUIZ' | 'CONVERSATION';

/** 마지막 선택 모드 localStorage 키 */
const LAST_MODE_KEY = 'ml_patient_last_mode';

/** 환자 대시보드 화면 단계 */
type DashboardPhase = 'LIST' | 'TRAINING' | 'QUIZ_LIST' | 'QUIZ_PLAY';

/** 선택된 훈련 정보 */
interface SelectedTraining {
  memoryEntryId: string;
  targetWord: string;
  /** 회상 단서 사진 (없을 수 있음) */
  photoUrl: string | null;
  /** 장소 태그 (사진 캡션용, 없을 수 있음) */
  locationTag: string | null;
}

/** localStorage에서 마지막 모드를 복원 (기본: 퀴즈 모드) */
function loadLastMode(): PatientMode {
  return localStorage.getItem(LAST_MODE_KEY) === 'CONVERSATION'
    ? 'CONVERSATION'
    : 'QUIZ';
}

/**
 * 환자 대시보드
 *
 * - 훈련 가능한 메모리 엔트리 목록 표시
 * - 시나리오가 준비된 항목에 "훈련 시작" 버튼
 * - 훈련 시작 클릭 시 TrainingScreen으로 전환
 */
export function PatientDashboard() {
  const { user, logout, isPatientMode, exitPatientMode } = useAuth();
  const navigate = useNavigate();

  // 보호자가 환자 모드로 진입한 경우 "보호자로 돌아가기"(PIN) 노출.
  // 환자 직접 로그인(하위호환)은 기존처럼 로그아웃 노출.
  const isCaregiverInPatientMode = user?.role === 'caregiver' && isPatientMode;
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  // 마지막 선택 모드 복원 — 퀴즈 모드면 퀴즈 목록, 대화 모드면 훈련 목록으로 진입.
  const [mode, setMode] = useState<PatientMode>(loadLastMode);
  const [phase, setPhase] = useState<DashboardPhase>(() =>
    loadLastMode() === 'QUIZ' ? 'QUIZ_LIST' : 'LIST',
  );
  const [selectedTraining, setSelectedTraining] = useState<SelectedTraining | null>(null);
  const [selectedQuizSetId, setSelectedQuizSetId] = useState<string | null>(null);
  const [entries, setEntries] = useState<AvailableEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  /** 모드 전환 — 마지막 모드를 localStorage에 저장하고 해당 모드 목록으로 이동 */
  const handleSelectMode = useCallback((next: PatientMode) => {
    localStorage.setItem(LAST_MODE_KEY, next);
    setMode(next);
    setSelectedQuizSetId(null);
    setSelectedTraining(null);
    setPhase(next === 'QUIZ' ? 'QUIZ_LIST' : 'LIST');
  }, []);

  /** 퀴즈 선택 → 풀이 화면 진입 */
  const handleSelectQuiz = useCallback((quizSetId: string) => {
    setSelectedQuizSetId(quizSetId);
    setPhase('QUIZ_PLAY');
  }, []);

  /** 퀴즈 종료/완료 → 퀴즈 목록으로 복귀 */
  const handleQuizExit = useCallback(() => {
    setSelectedQuizSetId(null);
    setPhase('QUIZ_LIST');
  }, []);

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

  // 대화 모드일 때만 훈련 엔트리를 불러온다(퀴즈 모드는 자체 목록 훅 사용).
  useEffect(() => {
    if (mode === 'CONVERSATION') {
      void loadEntries();
    }
  }, [mode, loadEntries]);

  /** "훈련 시작" 버튼 핸들러 */
  const handleStartTraining = useCallback(
    (entry: AvailableEntry, targetWord: string) => {
      setSelectedTraining({
        memoryEntryId: entry.id,
        targetWord,
        photoUrl: entry.photoUrl,
        locationTag: entry.locationTag,
      });
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

  // 훈련 화면(대화 모드)
  if (phase === 'TRAINING' && selectedTraining !== null) {
    return (
      <TrainingScreen
        memoryEntryId={selectedTraining.memoryEntryId}
        targetWord={selectedTraining.targetWord}
        photoUrl={selectedTraining.photoUrl}
        locationTag={selectedTraining.locationTag}
        onComplete={handleTrainingComplete}
      />
    );
  }

  // 퀴즈 풀이 화면(퀴즈 모드)
  if (phase === 'QUIZ_PLAY' && selectedQuizSetId !== null) {
    return (
      <div className="min-h-screen" style={{ background: WARM_SCREEN_BG }}>
        <QuizScreen quizSetId={selectedQuizSetId} onExit={handleQuizExit} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F6F3]">
      {/* 헤더 */}
      <header className="px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1A1916]">안녕하세요</h1>
          <p className="text-xl text-[#6B6560] mt-1">
            {user?.patientDisplayName ?? user?.displayName}님, 오늘도 함께
            훈련해요!
          </p>
        </div>
        {isCaregiverInPatientMode ? (
          <button
            type="button"
            onClick={() => setIsPinModalOpen(true)}
            className="min-h-[48px] px-5 py-2 bg-white/70 text-[#6B6560] text-lg font-medium rounded-full"
            aria-label="보호자로 돌아가기"
          >
            보호자로 돌아가기
          </button>
        ) : (
          <button
            type="button"
            onClick={logout}
            className="min-h-[48px] px-5 py-2 bg-white/70 text-[#6B6560] text-lg font-medium rounded-full"
            aria-label="로그아웃"
          >
            로그아웃
          </button>
        )}
      </header>

      <ReturnToCaregiverPinModal
        isOpen={isPinModalOpen}
        onCancel={() => setIsPinModalOpen(false)}
        onVerify={exitPatientMode}
      />

      {/* 메인 컨텐츠 */}
      <main className="px-6 py-6 max-w-2xl mx-auto">

        {/* 오늘의 치유 메시지 (Pattern 2) */}
        <DailyHealingBanner />

        {/* 개발 환경 전용: QAB 검사 바로가기 버튼 */}
        {import.meta.env.DEV && (
          <div className="mb-8 p-4 bg-[#EBF4F0] border border-[#c8e6d9] rounded-2xl flex flex-col items-center">
            <h3 className="text-xl font-bold text-[#1A4035] mb-2">테스트용 편의 기능</h3>
            <button
              type="button"
              onClick={() => navigate('/assessment')}
              className="w-full min-h-[48px] bg-[#2D6A56] hover:bg-[#1F5240] text-white text-xl font-bold rounded-full transition-colors"
            >
              LOC / SentComp 검사하러 가기
            </button>
          </div>
        )}

        {/* 모드 토글 (퀴즈 / 대화) — 마지막 선택은 localStorage에 저장 */}
        <ModeToggle mode={mode} onSelectMode={handleSelectMode} />

        {/* 퀴즈 모드: 퀴즈 목록 화면 위임 */}
        {mode === 'QUIZ' && (
          <QuizListScreen onSelectQuiz={handleSelectQuiz} />
        )}

        {/* 대화 모드: 기존 훈련 목록 */}
        {mode === 'CONVERSATION' && (
          <ConversationList
            isLoading={isLoading}
            error={error}
            entries={entries}
            onReload={() => void loadEntries()}
            onStartTraining={handleStartTraining}
          />
        )}
      </main>
    </div>
  );
}

// ─── 모드 토글 ──────────────────────────────────────────────────────────────

interface ModeToggleProps {
  mode: PatientMode;
  onSelectMode: (mode: PatientMode) => void;
}

/** 퀴즈 / 대화 두 학습 모드 전환 토글 */
function ModeToggle({ mode, onSelectMode }: ModeToggleProps) {
  const options: Array<{ value: PatientMode; label: string }> = [
    { value: 'QUIZ', label: '퀴즈 모드' },
    { value: 'CONVERSATION', label: '대화 모드' },
  ];

  return (
    <div
      className="mb-6 flex gap-2 rounded-full bg-white/50 p-1"
      role="tablist"
      aria-label="학습 모드 선택"
    >
      {options.map((opt) => {
        const isActive = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelectMode(opt.value)}
            className={`min-h-[48px] flex-1 rounded-full text-lg font-semibold transition-colors duration-[180ms] ease-out ${
              isActive
                ? 'bg-white text-[#2D6A56] shadow-sm'
                : 'bg-transparent text-[#6B6560] hover:text-[#1A1916]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── 대화 모드 목록 ─────────────────────────────────────────────────────────

interface ConversationListProps {
  isLoading: boolean;
  error: string | null;
  entries: AvailableEntry[];
  onReload: () => void;
  onStartTraining: (entry: AvailableEntry, targetWord: string) => void;
}

/** 대화(훈련) 모드의 엔트리 목록 — 기존 동작 유지 */
function ConversationList({
  isLoading,
  error,
  entries,
  onReload,
  onStartTraining,
}: ConversationListProps) {
  return (
    <>
      <h2 className="text-2xl font-semibold text-[#1A1916] mb-4">
        훈련 목록
      </h2>

      {/* 로딩 상태 */}
      {isLoading && (
          <div className="flex items-center justify-center py-16" role="status">
            <p className="text-2xl text-[#6B6560]">불러오는 중...</p>
          </div>
        )}

        {/* 에러 상태 */}
        {!isLoading && error !== null && (
          <div className="py-8 text-center" role="alert">
            <p className="text-xl text-[#C94040] mb-4">{error}</p>
            <button
              type="button"
              onClick={onReload}
              className="min-h-[48px] px-8 py-3 bg-[#2D6A56] text-white text-xl font-semibold rounded-full"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* 엔트리 없음 */}
        {!isLoading && error === null && entries.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-2xl text-[#6B6560]">
              아직 등록된 훈련이 없습니다.
            </p>
            <p className="text-xl text-[#9AA09B] mt-2">
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
                onStartTraining={onStartTraining}
              />
            ))}
          </ul>
        )}
    </>
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
    <li className="bg-white border border-[#E8E4DC] rounded-3xl overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
      <div className="flex gap-4 p-4">
        {/* 사진 썸네일 */}
        {entry.photoUrl !== null && (
          <img
            src={entry.photoUrl}
            alt="기억 사진"
            className="w-24 h-24 object-cover rounded-2xl flex-shrink-0"
          />
        )}

        {/* 엔트리 정보 */}
        <div className="flex-1 flex flex-col gap-2">
          {/* 장소 태그 */}
          {entry.locationTag !== null && (
            <p className="text-xl text-[#1A1916]">
              장소: <span className="font-semibold">{entry.locationTag}</span>
            </p>
          )}

          {/* 감정 태그 */}
          {entry.emotionTag !== null && (
            <p className="text-lg text-[#6B6560]">{entry.emotionTag}</p>
          )}

          {/* 목표 단어 선택 (여러 개인 경우) */}
          {entry.targetWords.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="text-lg text-[#6B6560]">연습할 단어 선택:</p>
              <div className="flex gap-2 flex-wrap">
                {entry.targetWords.map((word) => (
                  <button
                    key={word}
                    type="button"
                    onClick={() => setSelectedWord(word)}
                    className={`min-h-[40px] px-4 py-2 rounded-full text-lg font-medium transition-colors ${
                      selectedWord === word
                        ? 'bg-[#2D6A56] text-white'
                        : 'bg-[#EBF4F0] text-[#2D6A56]'
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
            <p className="text-xl text-[#1A1916]">
              연습 단어: <span className="font-bold text-[#2D6A56]">{entry.targetWords[0]}</span>
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
            className="w-full min-h-[56px] bg-[#2D6A56] text-white text-2xl font-bold rounded-full disabled:opacity-50 active:scale-[0.98] transition-transform"
            aria-label={`${entry.locationTag ?? '기억'} 훈련 시작`}
          >
            훈련 시작
          </button>
        ) : (
          <div className="w-full min-h-[56px] flex items-center justify-center bg-[#EBF4F0]/60 rounded-full">
            <p className="text-xl text-[#6B6560]">보호자가 준비 중이에요</p>
          </div>
        )}
      </div>
    </li>
  );
}

