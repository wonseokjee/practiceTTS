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
import { PracticeScreen } from '../practice/presentation/PracticeScreen.js';
import { startDestination } from '../domain/startDestination.js';
import { SoloDailyHome } from './SoloDailyHome.js';
import { WeekReviewScreen } from './WeekReviewScreen.js';
import { SoundCheckScreen } from './SoundCheckScreen.js';
import {
  isSoundCheckedToday,
  markSoundCheckedToday,
} from '../domain/soundCheck.js';
import { buildWeekStreak } from '../domain/streak.js';
import { quizApi } from '../quiz/infrastructure/QuizApi.js';
import type { QuizSetSummary } from '../quiz/domain/Quiz.js';
import { extractErrorMessage } from '../../shared/extractErrorMessage.js';
import { WARM_SCREEN_BG } from '../../shared/theme.js';
import { AuthedImage } from '../../shared/AuthedImage.js';
import { withHonorific } from '../../shared/honorific.js';
import { isConversationModeEnabled } from '../../shared/featureFlags.js';

/** 환자 학습 모드 (R9-a: localStorage에 마지막 모드 저장/복원) */
type PatientMode = 'QUIZ' | 'CONVERSATION';

/** 마지막 선택 모드 localStorage 키 */
const LAST_MODE_KEY = 'ml_patient_last_mode';

/** 환자 대시보드 화면 단계 */
type DashboardPhase =
  | 'LIST'
  | 'TRAINING'
  | 'QUIZ_HOME'
  | 'QUIZ_LIST'
  | 'QUIZ_PLAY'
  | 'PRACTICE'
  | 'WEEK_REVIEW'
  | 'SOUND_CHECK';

/** 선택된 훈련 정보 */
interface SelectedTraining {
  memoryEntryId: string;
  targetWord: string;
  /** 회상 단서 사진 (없을 수 있음) */
  photoUrl: string | null;
  /** 장소 태그 (사진 캡션용, 없을 수 있음) */
  locationTag: string | null;
}

/**
 * localStorage에서 마지막 모드를 복원 (기본: 퀴즈 모드)
 *
 * 대화 모드를 쓰던 사용자가 플래그가 꺼진 빌드를 받으면, 저장된 값 때문에
 * 선택할 수도 없는 모드에 갇힌다. 플래그가 꺼져 있으면 무조건 퀴즈로 돌린다.
 */
function loadLastMode(): PatientMode {
  if (!isConversationModeEnabled()) {
    return 'QUIZ';
  }
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
    loadLastMode() === 'QUIZ' ? 'QUIZ_HOME' : 'LIST',
  );
  /**
   * 솔로 홈 스트릭용 — 검사 **또는** 연습을 한 날짜(YYYY-MM-DD).
   * 조회 실패는 비차단(빈 배열).
   */
  const [activityDays, setActivityDays] = useState<string[]>([]);
  const [selectedTraining, setSelectedTraining] = useState<SelectedTraining | null>(null);
  /** 소리 확인을 통과하면 갈 곳. SOUND_CHECK 단계에서만 채워져 있다. */
  const [pendingPhase, setPendingPhase] = useState<
    'QUIZ_PLAY' | 'PRACTICE' | null
  >(null);
  const [selectedQuizSetId, setSelectedQuizSetId] = useState<string | null>(null);
  /** 홈에서 미리 받아 둔 풀 수 있는 퀴즈. null이면 아직 모름(조회 전·실패). */
  const [readySets, setReadySets] = useState<QuizSetSummary[] | null>(null);
  const [entries, setEntries] = useState<AvailableEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  /** 모드 전환 — 마지막 모드를 localStorage에 저장하고 해당 모드 목록으로 이동 */
  const handleSelectMode = useCallback((next: PatientMode) => {
    localStorage.setItem(LAST_MODE_KEY, next);
    setMode(next);
    setSelectedQuizSetId(null);
    setSelectedTraining(null);
    setPhase(next === 'QUIZ' ? 'QUIZ_HOME' : 'LIST');
  }, []);

  // 솔로 홈에 들어오면 연습 완료 날짜를 불러와 스트릭을 그린다(비차단).
  //
  // 준비된 퀴즈 목록도 함께 받아 둔다. '오늘 연습 시작하기'를 누른 뒤에 조회하면
  // 큰 버튼을 누르고 나서 아무 일도 안 일어나는 구간이 생긴다 — 이 사용자층에서
  // 그 침묵은 "안 눌렸나?"로 읽혀 다시 누르게 만든다.
  useEffect(() => {
    if (phase !== 'QUIZ_HOME') return;
    let alive = true;
    void quizApi
      .getActivityDays()
      .then((days) => {
        if (alive) setActivityDays(days);
      })
      .catch(() => {
        if (alive) setActivityDays([]);
      });
    void quizApi
      .listSets({ status: 'ready', limit: 20 })
      .then((sets) => {
        if (alive) setReadySets(sets);
      })
      .catch(() => {
        // 조회 실패는 비차단 — 목록 화면이 다시 시도한다.
        if (alive) setReadySets(null);
      });
    return () => {
      alive = false;
    };
  }, [phase]);

  /**
   * 세션으로 가되, 오늘 소리 확인이 안 끝났으면 확인 화면을 먼저 세운다.
   *
   * 검사·연습 둘 다 듣고 답하는 문항이 있다. 소리가 안 나는 채로 끝까지 가면
   * 듣기 문항 기록이 전부 찍기가 되고, 검사 쪽은 그 기록이 회복 추세로
   * 들어간다. 문 앞에서 한 문장 들려보는 값이 훨씬 싸다.
   */
  const goWithSoundCheck = useCallback((next: 'QUIZ_PLAY' | 'PRACTICE') => {
    if (isSoundCheckedToday()) {
      setPhase(next);
      return;
    }
    setPendingPhase(next);
    setPhase('SOUND_CHECK');
  }, []);

  /** 퀴즈 선택 → (소리 확인 →) 풀이 화면 진입 */
  const handleSelectQuiz = useCallback(
    (quizSetId: string) => {
      setSelectedQuizSetId(quizSetId);
      goWithSoundCheck('QUIZ_PLAY');
    },
    [goWithSoundCheck],
  );

  /**
   * '오늘 연습 시작하기' — 풀 수 있는 퀴즈가 하나면 **바로 시작한다.**
   *
   * 예전에는 무조건 목록 화면으로 보냈다. 버튼은 "시작하기"라고 적혀 있는데 고르는
   * 화면이 나오니 라벨이 어긋났고, 실제로 그 목록엔 카드가 하나뿐인 경우가 많다 —
   * 한 번 더 누르게 만드는 것 말고 하는 일이 없었다.
   *
   * 여럿이면 목록이 필요하다. 아직 못 받았으면(조회 전·실패) 목록으로 보내
   * 거기서 다시 시도하게 한다 — 홈에서 멈춰 세우지 않는다.
   */
  const handleStart = useCallback(() => {
    const to = startDestination(readySets);
    if (to.kind === 'quiz') {
      handleSelectQuiz(to.quizSetId);
      return;
    }
    setPhase('QUIZ_LIST');
  }, [readySets, handleSelectQuiz]);

  /**
   * 퀴즈 종료/완료 → **홈으로** 복귀.
   *
   * 예전에는 목록으로 되돌렸다. 그러면 세션을 끝낼 때마다 옛 세대 목록 화면을
   * 지나게 된다 — 시작 경로를 고쳐도 종료 경로로 다시 만난다. 끝냈으면 홈이다.
   */
  const handleQuizExit = useCallback(() => {
    setSelectedQuizSetId(null);
    setPhase('QUIZ_HOME');
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

  // 소리 사전 점검 — 검사·연습 앞의 문 하나. 하루 한 번만 선다.
  //
  // 통과("잘 들려요")할 때만 오늘 날짜를 적는다. 소리 없이 시작한 경우에는
  // 적지 않으므로 다음 세션에 다시 묻는다 — 소리를 켜고 오면 그때 통과한다.
  if (phase === 'SOUND_CHECK' && pendingPhase !== null) {
    const proceed = () => {
      setPhase(pendingPhase);
      setPendingPhase(null);
    };
    return (
      <div className="min-h-screen" style={{ background: WARM_SCREEN_BG }}>
        <SoundCheckScreen
          destination={pendingPhase === 'PRACTICE' ? '연습' : '검사'}
          onPass={() => {
            markSoundCheckedToday();
            proceed();
          }}
          onSkip={proceed}
          onCancel={() => {
            setPendingPhase(null);
            setSelectedQuizSetId(null);
            setPhase('QUIZ_HOME');
          }}
        />
      </div>
    );
  }

  // 연습 모드 — 터치 중심. 문항별로는 정답을 알려주지만(가르친다) 점수·정답률
  // 같은 집계는 내지 않는다. 결과는 검사와 다른 테이블(practice_results)로
  // 나가므로 회복 추세·레벨을 건드리지 않는다. 활동 일자만 스트릭에 합쳐진다.
  // 돌아보기 — 최근에 함께 본 기억. 소리를 쓰지 않으므로 소리 확인을 거치지 않는다.
  if (phase === 'WEEK_REVIEW') {
    return (
      <div className="min-h-screen bg-canvas">
        <WeekReviewScreen onBack={() => setPhase('QUIZ_HOME')} />
      </div>
    );
  }

  if (phase === 'PRACTICE') {
    return (
      <div className="min-h-screen" style={{ background: WARM_SCREEN_BG }}>
        <PracticeScreen onExit={() => setPhase('QUIZ_HOME')} />
      </div>
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

  // 솔로 일일 홈(퀴즈 모드 진입) — 단일 CTA + 이번 주 스트릭.
  // 인사·설정은 SoloDailyHome이 자체 렌더하므로, 대시보드 크롬 대신 최소 상단바만.
  if (phase === 'QUIZ_HOME') {
    return (
      <div className="min-h-screen bg-canvas">
        <header className="flex items-center justify-end px-6 py-4">
          <button
            type="button"
            onClick={
              isCaregiverInPatientMode ? () => setIsPinModalOpen(true) : logout
            }
            className="min-h-[44px] rounded-full bg-white/70 px-4 py-2 text-base font-medium text-muted-sage"
            aria-label={isCaregiverInPatientMode ? '보호자로 돌아가기' : '로그아웃'}
          >
            {isCaregiverInPatientMode ? '보호자로' : '로그아웃'}
          </button>
        </header>
        <ReturnToCaregiverPinModal
          isOpen={isPinModalOpen}
          onCancel={() => setIsPinModalOpen(false)}
          onVerify={exitPatientMode}
        />
        <SoloDailyHome
          greetingName={withHonorific(
            user?.patientDisplayName ?? user?.displayName,
            '님',
            { separator: '' },
          )}
          streakDays={buildWeekStreak(new Set(activityDays))}
          onStart={handleStart}
          onPractice={() => goWithSoundCheck('PRACTICE')}
          onReview={() => setPhase('WEEK_REVIEW')}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* 헤더 */}
      <header className="px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ink">안녕하세요</h1>
          <p className="text-xl text-muted-sage mt-1">
            {withHonorific(
              user?.patientDisplayName ?? user?.displayName,
              '님',
              { separator: '' },
            )}
            , 오늘도 함께 훈련해요!
          </p>
        </div>
        {isCaregiverInPatientMode ? (
          <button
            type="button"
            onClick={() => setIsPinModalOpen(true)}
            className="min-h-[48px] px-5 py-2 bg-white/70 text-muted-sage text-lg font-medium rounded-full"
            aria-label="보호자로 돌아가기"
          >
            보호자로 돌아가기
          </button>
        ) : (
          <button
            type="button"
            onClick={logout}
            className="min-h-[48px] px-5 py-2 bg-white/70 text-muted-sage text-lg font-medium rounded-full"
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

        {/* 모드 토글 (퀴즈 / 대화 / 기본 검사) — 마지막 선택은 localStorage에 저장.
            기본 검사는 개인 맞춤 없이 표준 문항으로 언어·인지를 점검하는 진입점. */}
        <ModeToggle
          mode={mode}
          onSelectMode={handleSelectMode}
          onOpenAssessment={() => navigate('/assessment')}
        />

        {/* 퀴즈 모드: 퀴즈 목록 화면 위임 */}
        {mode === 'QUIZ' && (
          <QuizListScreen onSelectQuiz={handleSelectQuiz} />
        )}

        {/* 대화 모드: 기존 훈련 목록 (플래그 꺼짐이면 도달 불가) */}
        {mode === 'CONVERSATION' && isConversationModeEnabled() && (
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
  /** 표준 언어·인지 검사(개인 맞춤 없음) 화면으로 이동 */
  onOpenAssessment: () => void;
}

/**
 * 퀴즈 / 대화 / 기본 검사 선택 토글.
 * - 퀴즈·대화는 학습 모드 전환(localStorage 저장)
 * - 기본 검사는 개인 맞춤 없이 표준 문항으로 언어·인지를 점검하는 검사 화면으로 이동
 */
function ModeToggle({ mode, onSelectMode, onOpenAssessment }: ModeToggleProps) {
  // 대화는 플래그로 감춘다. 비활성 탭으로 남겨두면 환자가 눌러보고
  // 반응이 없어 혼란스러우므로, 아예 렌더하지 않는다.
  const options: Array<{ value: PatientMode; label: string }> = [
    { value: 'QUIZ', label: '퀴즈' },
    ...(isConversationModeEnabled()
      ? [{ value: 'CONVERSATION' as const, label: '대화' }]
      : []),
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
            className={`min-h-[48px] flex-1 rounded-full text-base font-semibold transition-colors duration-[180ms] ease-out ${
              isActive
                ? 'bg-white text-primary shadow-sm'
                : 'bg-transparent text-muted-sage hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}

      {/* 기본 검사 — 모드 전환이 아니라 표준 검사 화면으로 이동(개인 맞춤 없음) */}
      <button
        type="button"
        onClick={onOpenAssessment}
        aria-label="표준 언어·인지 검사 (사진·일기 없이 기본 문항으로 점검)"
        className="min-h-[48px] flex-1 rounded-full text-base font-semibold bg-transparent text-muted-sage transition-colors duration-[180ms] ease-out hover:text-ink"
      >
        기본 검사
      </button>
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
      <h2 className="text-2xl font-semibold text-ink mb-4">
        훈련 목록
      </h2>

      {/* 로딩 상태 */}
      {isLoading && (
          <div className="flex items-center justify-center py-16" role="status">
            <p className="text-2xl text-muted-sage">불러오는 중...</p>
          </div>
        )}

        {/* 에러 상태 */}
        {!isLoading && error !== null && (
          <div className="py-8 text-center" role="alert">
            <p className="text-xl text-danger mb-4">{error}</p>
            <button
              type="button"
              onClick={onReload}
              className="min-h-[48px] px-8 py-3 bg-primary text-white text-xl font-semibold rounded-full"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* 엔트리 없음 */}
        {!isLoading && error === null && entries.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-2xl text-muted-sage">
              아직 등록된 훈련이 없습니다.
            </p>
            <p className="text-xl text-muted-sage mt-2">
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
    <li className="bg-white border border-line rounded-3xl overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
      <div className="flex gap-4 p-4">
        {/* 사진 썸네일 */}
        {entry.photoUrl !== null && (
          <AuthedImage
            src={entry.photoUrl}
            alt="기억 사진"
            className="w-24 h-24 object-cover rounded-2xl flex-shrink-0"
          />
        )}

        {/* 엔트리 정보 */}
        <div className="flex-1 flex flex-col gap-2">
          {/* 장소 태그 */}
          {entry.locationTag !== null && (
            <p className="text-xl text-ink">
              장소: <span className="font-semibold">{entry.locationTag}</span>
            </p>
          )}

          {/* 감정 태그 */}
          {entry.emotionTag !== null && (
            <p className="text-lg text-muted-sage">{entry.emotionTag}</p>
          )}

          {/* 목표 단어 선택 (여러 개인 경우) */}
          {entry.targetWords.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="text-lg text-muted-sage">연습할 단어 선택:</p>
              <div className="flex gap-2 flex-wrap">
                {entry.targetWords.map((word) => (
                  <button
                    key={word}
                    type="button"
                    onClick={() => setSelectedWord(word)}
                    className={`min-h-[40px] px-4 py-2 rounded-full text-lg font-medium transition-colors ${
                      selectedWord === word
                        ? 'bg-primary text-white'
                        : 'bg-primary-light text-primary'
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
            <p className="text-xl text-ink">
              연습 단어: <span className="font-bold text-primary">{entry.targetWords[0]}</span>
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
            className="w-full min-h-[56px] bg-primary text-white text-2xl font-bold rounded-full disabled:opacity-50 active:scale-[0.98] transition-transform"
            aria-label={`${entry.locationTag ?? '기억'} 훈련 시작`}
          >
            훈련 시작
          </button>
        ) : (
          <div className="w-full min-h-[56px] flex items-center justify-center bg-primary-light/60 rounded-full">
            <p className="text-xl text-muted-sage">보호자가 준비 중이에요</p>
          </div>
        )}
      </div>
    </li>
  );
}

