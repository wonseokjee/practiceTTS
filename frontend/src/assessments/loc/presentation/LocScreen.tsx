/**
 * LOC(의식 수준) 검사 화면 - Composition Root
 *
 * 이 컴포넌트는 다음 두 가지 역할을 담당한다:
 * 1. Composition Root: 모든 의존성(UseCase, Repository, Service)을 생성하고 조립
 * 2. 레이아웃 렌더링: useLocViewModel에서 받은 상태를 하위 컴포넌트에 전달
 *
 * 비즈니스 로직은 useLocViewModel에, 렌더링만 이 컴포넌트에 존재한다.
 *
 * sessionId와 patientId는 SessionContext에서 주입받는다.
 */

import { useMemo, useCallback } from 'react';
import { ConductLocTrialUseCase } from '../application/ConductLocTrialUseCase.js';
import { FinishLocAssessmentUseCase } from '../application/FinishLocAssessmentUseCase.js';
import { LocalStorageLocResultRepository } from '../infrastructure/LocalStorageLocResultRepository.js';
import { StaticFileTtsService } from '../../../shared/infrastructure/StaticFileTtsService.js';
import { HtmlAudioPlayer } from '../../../shared/infrastructure/HtmlAudioPlayer.js';
import { WebSpeechTtsService } from '../../../shared/infrastructure/WebSpeechTtsService.js';
import { STATIC_TTS_MANIFEST } from '../../../assets/data/staticTtsManifest.js';
import { useLocViewModel } from './useLocViewModel.js';
import { useSessionContext } from '../../../shared/session/SessionContext.js';
import { LocTouchButton } from './components/LocTouchButton.js';
import { LocProgressBar } from './components/LocProgressBar.js';
import { LocAudioIndicator } from './components/LocAudioIndicator.js';
import type { LocTrialResponseDTO } from '../application/dto/LocTrialDTO.js';

interface LocScreenProps {
  onComplete?: (resultId: string) => void;
  onProceed?: () => void;
}

/** 시도 결과 행 컴포넌트 */
function TrialResultRow({ result }: { result: LocTrialResponseDTO }) {
  const scoreColorClass =
    result.score === 3
      ? 'text-green-600'
      : result.score === 2
        ? 'text-yellow-600'
        : result.score === 1
          ? 'text-orange-600'
          : 'text-red-600';

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100">
      <span className="text-gray-600">시도 {result.trialNumber}</span>
      <span className={`font-semibold ${scoreColorClass}`}>
        {result.scoreLabel}
        {result.latencyMs !== null && (
          <span className="text-gray-400 font-normal text-sm ml-2">
            ({Math.round(result.latencyMs)}ms)
          </span>
        )}
      </span>
      <span className={`font-bold text-lg ${scoreColorClass}`}>
        {result.score}점
      </span>
    </div>
  );
}

export function LocScreen({ onComplete, onProceed }: LocScreenProps) {
  // === 세션 컨텍스트 ===
  const { session, endSession } = useSessionContext();
  const sessionId = session?.sessionId ?? '';
  const patientId = session?.patientId ?? '';

  // === Composition Root: 의존성 생성 및 조립 ===
  // StaticFileTtsService: 정적 MP3 파일 재생, 매핑 없는 텍스트는 WebSpeechTtsService로 폴백
  const ttsService = useMemo(
    () =>
      new StaticFileTtsService(
        STATIC_TTS_MANIFEST,
        new HtmlAudioPlayer(),
        new WebSpeechTtsService(),
      ),
    [],
  );
  const resultRepository = useMemo(
    () => new LocalStorageLocResultRepository(),
    [],
  );
  const conductTrialUseCase = useMemo(
    () => new ConductLocTrialUseCase(ttsService),
    [ttsService],
  );
  const finishAssessmentUseCase = useMemo(
    () => new FinishLocAssessmentUseCase(resultRepository),
    [resultRepository],
  );

  const handleComplete = useCallback(
    (resultId: string) => {
      onComplete?.(resultId);
    },
    [onComplete],
  );

  // === ViewModel ===
  const { viewState, actions } = useLocViewModel(
    conductTrialUseCase,
    finishAssessmentUseCase,
    handleComplete,
    sessionId,
    patientId,
  );

  const {
    assessmentState,
    currentTrialNumber,
    remainingSeconds,
    trialResults,
    finalScore,
    errorMessage,
    isTtsPlaying,
    isButtonEnabled,
  } = viewState;

  // === 렌더링 ===
  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white shadow-sm px-6 py-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            의식 수준(LOC) 검사
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            QAB 하위검사 1번 &nbsp;·&nbsp; 환자: <span className="font-medium text-gray-700">{patientId}</span>
          </p>
        </div>
        <button
          type="button"
          className="text-xs text-gray-400 hover:text-red-500 transition-colors mt-1"
          onClick={endSession}
        >
          세션 종료
        </button>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 flex flex-col px-6 py-4 gap-4 max-w-2xl mx-auto w-full overflow-y-auto min-h-0">

        {/* 진행 상태 표시 */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600 font-medium">
            시도 {currentTrialNumber} / 3
          </span>
          <span className="text-sm text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
            {assessmentState === 'IDLE' && '대기 중'}
            {assessmentState === 'TTS_PLAYING' && '음성 재생 중'}
            {assessmentState === 'AWAITING_TOUCH' && '터치 대기 중'}
            {assessmentState === 'TOUCH_DETECTED' && '처리 중'}
            {assessmentState === 'TRIAL_COMPLETE' && '시도 완료'}
            {assessmentState === 'ASSESSMENT_COMPLETE' && '검사 완료'}
          </span>
        </div>

        {/* 에러 메시지 */}
        {errorMessage !== null && (
          <div
            className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        {/* TTS 재생 중 표시 + 카운트다운 진행 바 (검사 완료 화면에서는 숨김) */}
        {assessmentState !== 'ASSESSMENT_COMPLETE' && (
          <>
            <div className="flex justify-center py-2">
              <LocAudioIndicator isTtsPlaying={isTtsPlaying} />
            </div>
            <LocProgressBar
              isActive={assessmentState === 'AWAITING_TOUCH'}
              remainingSeconds={remainingSeconds}
              totalSeconds={10}
            />
          </>
        )}

        {/* 검사 완료 화면 */}
        {assessmentState === 'ASSESSMENT_COMPLETE' ? (
          <div className="flex flex-col items-center gap-6 py-8">
            <div className="text-6xl">✅</div>
            <h2 className="text-2xl font-bold text-gray-800">검사 완료</h2>

            {/* 최종 점수 */}
            <div className="bg-white rounded-2xl shadow-md p-6 w-full">
              <p className="text-gray-500 text-sm text-center mb-2">최종 점수</p>
              <p className="text-5xl font-bold text-center text-blue-600">
                {finalScore}
                <span className="text-xl text-gray-400 font-normal"> / 3</span>
              </p>
            </div>

            {/* 시도별 결과 */}
            <div className="bg-white rounded-2xl shadow-md p-6 w-full">
              <h3 className="font-semibold text-gray-700 mb-3">시도별 결과</h3>
              {trialResults.map((result) => (
                <TrialResultRow key={result.trialNumber} result={result} />
              ))}
            </div>

            {/* 다음 검사 버튼 */}
            <button
              type="button"
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
              onClick={() => {
                actions.proceedToNextAssessment();
                onProceed?.();
              }}
            >
              다음 검사로 이동
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            {/* 대형 터치 버튼 */}
            <LocTouchButton
              isSelectable={isButtonEnabled}
              onTouch={actions.handleButtonTouch}
            />

            {/* 시작 버튼 (IDLE 상태에서만 활성, 다른 상태에서는 공간 유지) */}
            <button
              type="button"
              className={`w-full bg-blue-500 text-white font-semibold py-4 rounded-2xl text-lg transition-colors ${
                assessmentState === 'IDLE'
                  ? 'hover:bg-blue-600'
                  : 'invisible pointer-events-none'
              }`}
              onClick={() => { void actions.startAssessment(); }}
            >
              검사 시작
            </button>
          </div>
        )}

        {/* 시도 결과 이력 (검사 진행 중) */}
        {trialResults.length > 0 &&
          assessmentState !== 'ASSESSMENT_COMPLETE' && (
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h3 className="font-semibold text-gray-700 mb-2 text-sm">
                진행 결과
              </h3>
              {trialResults.map((result) => (
                <TrialResultRow key={result.trialNumber} result={result} />
              ))}
            </div>
          )}
      </main>
    </div>
  );
}
