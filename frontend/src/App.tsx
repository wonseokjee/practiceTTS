import { useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
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
  const { session } = useSessionContext();

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

  if (session === null) {
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
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-500">로딩 중...</span>
      </div>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'caregiver') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">보호자 계정으로만 접근할 수 있습니다.</p>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * 환자 전용 라우트: role이 patient가 아니면 접근 거부
 */
function PatientRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-500">로딩 중...</span>
      </div>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'patient') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">환자 계정으로만 접근할 수 있습니다.</p>
      </div>
    );
  }

  return <>{children}</>;
}

// ─── 루트 리다이렉트 ──────────────────────────────────────────

/**
 * "/" 경로: 로그인 상태와 역할에 따라 적절한 경로로 리다이렉트
 */
function RootRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-500">로딩 중...</span>
      </div>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'caregiver') {
    return <Navigate to="/caregiver" replace />;
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
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-500">로딩 중...</span>
      </div>
    );
  }

  if (user !== null) {
    if (user.role === 'caregiver') return <Navigate to="/caregiver" replace />;
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
