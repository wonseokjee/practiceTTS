import { useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import type { ReactNode } from 'react';
import { SessionProvider, useSessionContext } from './shared/session/SessionContext.js';
import { PatientSetupScreen } from './shared/session/PatientSetupScreen.js';
import { LocScreen } from './assessments/loc/presentation/LocScreen.js';
import { SentCompScreen } from './assessments/sentComp/presentation/SentCompScreen.js';
import { WordComprehensionScreen } from './assessments/wordComp/presentation/screens/WordComprehensionScreen.js';
import { AssessmentHubScreen } from './shared/hub/AssessmentHubScreen.js';
import type { ScoreDTO } from './assessments/sentComp/application/dtos.js';
import type { SessionSummaryDTO } from './assessments/wordComp/application/dtos/SessionSummaryDTO.js';
import { AuthProvider, useAuth } from './memory-link/shared/AuthContext.js';
import { LoginScreen } from './memory-link/shared/LoginScreen.js';
import { SocialCallbackScreen } from './memory-link/shared/SocialCallbackScreen.js';
import { OnboardingScreen } from './memory-link/shared/OnboardingScreen.js';
import { CaregiverDashboard } from './memory-link/caregiver/presentation/CaregiverDashboard.js';
import { PatientDashboard } from './memory-link/patient/presentation/PatientDashboard.js';

// ─── QAB 평가 화면 (기존 로직 유지) ──────────────────────────

type AppPhase = 'LOC' | 'HUB' | 'SENT_COMP' | 'WORD_COMP';
type AssessmentId = 'sentComp' | 'wordComp';

interface CompletedAssessments {
  sentComp: boolean;
  wordComp: boolean;
}

function AssessmentContent() {
  const { session, startSession } = useSessionContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  // 로그인 사용자용 세션을 최초 1회만 자동 생성했는지 추적.
  // (종료 후 자동 재생성되어 '세션 종료'가 안 먹던 문제 방지)
  const hasAutoStartedRef = useRef(false);

  // 로그인 사용자의 환자 ID를 검사 세션에 자동 사용 (보호자=연결 환자, 환자=본인).
  // 회원 로그인을 하므로 환자 ID 수동 입력은 불필요하다.
  const effectivePatientId = user
    ? user.role === 'caregiver'
      ? user.patientId
      : user.id
    : null;
  // 화면 표시용 환자 이름 (보호자=돌보는 어르신 성함, 환자=본인 이름)
  const effectivePatientName = user
    ? user.role === 'caregiver'
      ? (user.patientDisplayName ?? undefined)
      : user.displayName
    : undefined;

  const [appPhase, setAppPhase] = useState<AppPhase>('LOC');
  const [completedAssessments, setCompletedAssessments] =
    useState<CompletedAssessments>({ sentComp: false, wordComp: false });

  const handleLocComplete = (resultId: string): void => {
    console.log('LOC 검사 완료. 결과 ID:', resultId);
  };

  const handleLocProceed = (): void => {
    setAppPhase('HUB');
  };

  const handleHubSelect = (id: AssessmentId): void => {
    if (id === 'sentComp') setAppPhase('SENT_COMP');
    else setAppPhase('WORD_COMP');
  };

  const handleSentCompComplete = (_score: ScoreDTO): void => {
    setCompletedAssessments((prev) => ({ ...prev, sentComp: true }));
    setAppPhase('HUB');
  };

  const handleWordCompComplete = (_summary: SessionSummaryDTO): void => {
    setCompletedAssessments((prev) => ({ ...prev, wordComp: true }));
    setAppPhase('HUB');
  };

  // 로그인 사용자의 환자 ID/이름과 세션이 일치하지 않으면(미생성 · 옛 수동입력값 ·
  // 이름 미반영) 동기화한다.
  const needsSync =
    effectivePatientId !== null &&
    (session?.patientId !== effectivePatientId ||
      (effectivePatientName !== undefined &&
        session?.patientName !== effectivePatientName));

  // 최초 진입 시 1회만 자동 세션 생성. 이후 세션 종료(session=null)는 재생성하지
  // 않고 아래 effect가 대시보드로 복귀시킨다.
  useEffect(() => {
    if (needsSync && effectivePatientId && !hasAutoStartedRef.current) {
      startSession(effectivePatientId, effectivePatientName);
      hasAutoStartedRef.current = true;
    }
  }, [needsSync, effectivePatientId, effectivePatientName, startSession]);

  // 세션 종료 시 로그인 사용자는 원래 화면(역할별 대시보드)으로 복귀.
  useEffect(() => {
    if (hasAutoStartedRef.current && session === null && user) {
      navigate(user.role === 'caregiver' ? '/caregiver' : '/patient', {
        replace: true,
      });
    }
  }, [session, user, navigate]);

  if (session === null || needsSync) {
    // 로그인되어 환자 ID가 있으면 위 effect가 곧 세션을 만든다(짧은 대기).
    // 비로그인 등으로 환자 ID가 없을 때만 수동 입력 폴백을 보여준다.
    if (effectivePatientId) {
      return (
        <div className="h-full bg-canvas flex items-center justify-center p-6">
          <p className="text-muted-sage">검사를 준비하고 있어요...</p>
        </div>
      );
    }
    return <PatientSetupScreen />;
  }

  if (appPhase === 'LOC') {
    return (
      <LocScreen
        onComplete={handleLocComplete}
        onProceed={handleLocProceed}
      />
    );
  }

  if (appPhase === 'HUB') {
    return (
      <AssessmentHubScreen
        completedAssessments={completedAssessments}
        onSelect={handleHubSelect}
      />
    );
  }

  if (appPhase === 'SENT_COMP') {
    return <SentCompScreen onComplete={handleSentCompComplete} />;
  }

  return <WordComprehensionScreen onComplete={handleWordCompComplete} />;
}

// ─── 라우트 가드 ──────────────────────────────────────────────

/**
 * 보호자 전용 라우트: role이 caregiver가 아니면 접근 거부
 */
function CaregiverRoute({ children }: { children: ReactNode }) {
  const { user, isLoading, isPatientMode } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-muted-sage">로딩 중...</span>
      </div>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'caregiver') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-danger">보호자 계정으로만 접근할 수 있습니다.</p>
      </div>
    );
  }

  // 소셜 최초 로그인: 어르신 성함·PIN 미입력이면 온보딩 먼저.
  if (user.needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  // 환자 모드 중에는 보호자 화면 직접 접근 차단(PIN으로만 복귀) → /patient로 유지
  if (isPatientMode) {
    return <Navigate to="/patient" replace />;
  }

  return <>{children}</>;
}

/**
 * 온보딩 전용 라우트: 소셜 최초 로그인(보호자 + needsOnboarding)만 허용.
 * 이미 온보딩된 보호자는 대시보드로, 비로그인은 로그인으로.
 */
function OnboardingRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-muted-sage">로딩 중...</span>
      </div>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== 'caregiver' || !user.needsOnboarding) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/**
 * 환자 전용 라우트: 환자 본인(하위호환) 또는 환자 모드의 보호자만 허용
 */
function PatientRoute({ children }: { children: ReactNode }) {
  const { user, isLoading, isPatientMode } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-muted-sage">로딩 중...</span>
      </div>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  // 하위호환: 환자 직접 로그인
  if (user.role === 'patient') {
    return <>{children}</>;
  }

  // 보호자 단일 계정 모델: 환자 모드 + 연결된 환자가 있을 때만 허용
  if (user.role === 'caregiver') {
    if (isPatientMode && user.patientId !== null) {
      return <>{children}</>;
    }
    return <Navigate to="/caregiver" replace />;
  }

  return <Navigate to="/login" replace />;
}

// ─── 루트 리다이렉트 ──────────────────────────────────────────

/**
 * "/" 경로: 로그인 상태와 역할에 따라 적절한 경로로 리다이렉트
 */
function RootRedirect() {
  const { user, isLoading, isPatientMode } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-muted-sage">로딩 중...</span>
      </div>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'caregiver') {
    // 소셜 최초 로그인은 온보딩부터
    if (user.needsOnboarding) {
      return <Navigate to="/onboarding" replace />;
    }
    // 환자 모드 잠금 중에는 "/" 접근도 환자 화면 유지
    return <Navigate to={isPatientMode ? '/patient' : '/caregiver'} replace />;
  }

  if (user.role === 'patient') {
    return <Navigate to="/patient" replace />;
  }

  // therapist 등 기타 역할은 /login으로
  return <Navigate to="/login" replace />;
}

// ─── 로그인 화면 래퍼 ─────────────────────────────────────────

/**
 * 이미 로그인된 상태로 /login 접근 시 역할에 따라 리다이렉트
 */
function LoginRoute() {
  const { user, isLoading, isPatientMode } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-muted-sage">로딩 중...</span>
      </div>
    );
  }

  if (user !== null) {
    if (user.role === 'caregiver') {
      if (user.needsOnboarding) return <Navigate to="/onboarding" replace />;
      return <Navigate to={isPatientMode ? '/patient' : '/caregiver'} replace />;
    }
    if (user.role === 'patient') return <Navigate to="/patient" replace />;
  }

  return <LoginScreen />;
}

// ─── QAB 평가 래퍼 ───────────────────────────────────────────

/**
 * 기존 QAB 평가는 /assessment/* 경로에서 독립적으로 동작.
 * 인증 없이도 접근 가능하도록 SessionProvider만 래핑.
 */
function AssessmentWrapper() {
  return (
    <SessionProvider>
      <AssessmentContent />
    </SessionProvider>
  );
}

// ─── App ─────────────────────────────────────────────────────

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* 루트: 역할에 따라 리다이렉트 */}
          <Route path="/" element={<RootRedirect />} />

          {/* 로그인 / 회원가입 */}
          <Route path="/login" element={<LoginRoute />} />

          {/* 소셜 로그인 콜백(일회용 코드 교환) — 인증 전이라 가드 없음 */}
          <Route path="/auth/callback" element={<SocialCallbackScreen />} />

          {/* 소셜 최초 로그인 온보딩(어르신 성함·PIN) */}
          <Route
            path="/onboarding"
            element={
              <OnboardingRoute>
                <OnboardingScreen />
              </OnboardingRoute>
            }
          />

          {/* 보호자 전용 라우트 */}
          <Route
            path="/caregiver/*"
            element={
              <CaregiverRoute>
                <CaregiverDashboard />
              </CaregiverRoute>
            }
          />

          {/* 환자 전용 라우트 */}
          <Route
            path="/patient/*"
            element={
              <PatientRoute>
                <PatientDashboard />
              </PatientRoute>
            }
          />

          {/* QAB 평가 - 기존 기능 유지, 인증 불필요 */}
          <Route path="/assessment/*" element={<AssessmentWrapper />} />

          {/* 알 수 없는 경로는 루트로 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
