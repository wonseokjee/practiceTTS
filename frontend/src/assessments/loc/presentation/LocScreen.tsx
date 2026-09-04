/**
 * LOC(의식 수준) 검사 화면 - Composition Root
 *
 * 이 컴포넌트는 다음 두 가지 역할을 담당한다:
 * 1. Composition Root: 모든 의존성(UseCase, Repository, Service)을 생성하고 조립
 * 2. 레이아웃 렌더링: useLocViewModel에서 받은 상태를 하위 컴포넌트에 전달
 *
 * 비즈니스 로직은 useLocViewModel에, 렌더링만 이 컴포넌트에 존재한다.
 *
 * UI 원칙(직관성):
 * - "지금 이 순간 할 일"을 화면 중앙에 하나만 크게 노출한다.
 *   IDLE → 시작 버튼 / TTS_PLAYING → 안내+음파 / AWAITING_TOUCH → 큰 터치 버튼+카운트다운
 *   / 처리 중 → 확인 표시 / 완료 → 결과.
 * - 상태를 여러 곳에 중복 표기하거나 invisible로 깜빡이게 하지 않는다.
 *
 * sessionId와 patientId는 SessionContext에서 주입받는다.
 */

import { useMemo, useCallback } from 'react';
import { ConductLocTrialUseCase } from '../application/ConductLocTrialUseCase.js';
import { FinishLocAssessmentUseCase } from '../application/FinishLocAssessmentUseCase.js';
import { LocalStorageLocResultRepository } from '../infrastructure/LocalStorageLocResultRepository.js';
import { ServerAssessmentResultSubmitter } from '../../shared/infrastructure/AssessmentResultSubmitter.js';
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
      ? 'text-primary'
      : result.score === 2
        ? 'text-[#8a5a1a]'
        : result.score === 1
          ? 'text-accent-strong'
          : 'text-danger';

  return (
    <div className="flex items-center justify-between py-2 border-b border-line">
      <span className="text-muted">시도 {result.trialNumber}</span>
      <span className={`font-semibold ${scoreColorClass}`}>
        {result.scoreLabel}
        {result.latencyMs !== null && (
          <span className="text-muted font-normal text-sm ml-2">
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

/** 시도 진행 점 표시 (1/3, 2/3, 3/3) */
function TrialDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`시도 ${current} / 3`}>
      <span className="text-muted font-medium">시도 {current} / 3</span>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-2.5 w-2.5 rounded-full ${
              n <= current ? 'bg-primary' : 'bg-line'
            }`}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

export function LocScreen({ onComplete, onProceed }: LocScreenProps) {
  // === 세션 컨텍스트 ===
  const { session, endSession } = useSessionContext();
  const sessionId = session?.sessionId ?? '';
  const patientId = session?.patientId ?? '';
  // 표시용 환자 이름 (없으면 식별자로 폴백)
  const patientLabel = session?.patientName ?? patientId;

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
  const resultSubmitter = useMemo(
    () => new ServerAssessmentResultSubmitter(),
    [],
  );

  const finishAssessmentUseCase = useMemo(
    // 로컬 저장 + 서버 저장. 로컬만 두면 캐시를 지우는 순간 임상 기록이
    // 사라지고, 보호자가 회복 추이를 볼 수 없다.
    () => new FinishLocAssessmentUseCase(resultRepository, resultSubmitter),
    [resultRepository, resultSubmitter],
  );

  const handleComplete = useCallback(
    (resultId: string) => {
      onComplete?.(resultId);
    },
    [onComplete],
  );

  // === ViewModel ===
  const { viewState, actions, touchButtonRef } = useLocViewModel(
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

  const isComplete = assessmentState === 'ASSESSMENT_COMPLETE';
  const isProcessing =
    assessmentState === 'TOUCH_DETECTED' ||
    assessmentState === 'TRIAL_COMPLETE';

  // === 렌더링 ===
  return (
    <div className="h-full bg-canvas flex flex-col">
      {/* 헤더 */}
      <header className="bg-white shadow-sm px-6 py-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">
            의식 수준(LOC) 검사
          </h1>
          <p className="text-sm text-muted mt-1">
            QAB 하위검사 1번 &nbsp;·&nbsp; 환자:{' '}
            <span className="font-medium text-ink">{patientLabel}</span>
          </p>
        </div>
        <button
          type="button"
          className="text-xs text-muted hover:text-danger transition-colors mt-1"
          onClick={endSession}
        >
          세션 종료
        </button>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 flex flex-col px-6 py-4 gap-4 max-w-2xl mx-auto w-full overflow-y-auto min-h-0">
        {isComplete ? (
          /* ===== 검사 완료 화면 ===== */
          <div className="flex flex-col items-center gap-6 py-8">
            <div className="text-6xl">✅</div>
            <h2 className="text-2xl font-bold text-ink">검사 완료</h2>

            {/* 최종 점수 */}
            <div className="bg-white rounded-2xl shadow-md p-6 w-full">
              <p className="text-muted text-sm text-center mb-2">최종 점수</p>
              <p className="text-5xl font-bold text-center text-primary">
                {finalScore}
                <span className="text-xl text-muted font-normal"> / 3</span>
              </p>
            </div>

            {/* 시도별 결과 */}
            <div className="bg-white rounded-2xl shadow-md p-6 w-full">
              <h3 className="font-semibold text-ink mb-3">시도별 결과</h3>
              {trialResults.map((result) => (
                <TrialResultRow key={result.trialNumber} result={result} />
              ))}
            </div>

            {/* 다음 검사 버튼 */}
            <button
              type="button"
              className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-4 rounded-2xl text-lg transition-colors"
              onClick={() => {
                actions.proceedToNextAssessment();
                onProceed?.();
              }}
            >
              다음 검사로 이동
            </button>
          </div>
        ) : (
          /* ===== 검사 진행 화면 ===== */
          <>
            {/* 상단: 시도 진행 표시 */}
            <TrialDots current={currentTrialNumber} />

            {/* 에러 메시지 */}
            {errorMessage !== null && (
              <div
                className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-danger"
                role="alert"
              >
                {errorMessage}
              </div>
            )}

            {/* 중앙: 현재 상태에서 할 일 하나만 크게 */}
            <div className="flex-1 flex flex-col min-h-0">
              {assessmentState === 'IDLE' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-7 text-center">
                  <div className="text-6xl" aria-hidden="true">🎧</div>
                  <div>
                    <h2 className="text-2xl font-bold text-ink">
                      검사를 시작할까요?
                    </h2>
                    <p className="mt-3 text-lg leading-relaxed text-muted">
                      시작을 누르면 소리가 나와요.
                      <br />
                      소리를 들은 뒤 화면을 터치해 주세요.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="w-full max-w-sm bg-primary hover:bg-primary-dark text-white font-semibold py-4 rounded-2xl text-xl transition-colors"
                    onClick={() => {
                      void actions.startAssessment();
                    }}
                  >
                    검사 시작
                  </button>
                </div>
              )}

              {assessmentState === 'TTS_PLAYING' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
                  <LocAudioIndicator isTtsPlaying={isTtsPlaying} />
                  <div>
                    <h2 className="text-2xl font-bold text-primary">
                      잘 들어보세요
                    </h2>
                    <p className="mt-2 text-lg text-muted">
                      소리가 끝나면 화면을 터치할 수 있어요.
                    </p>
                  </div>
                </div>
              )}

              {assessmentState === 'AWAITING_TOUCH' && (
                // 버튼이 아니라 이 영역이 pointerdown을 받는다. 환자가 버튼을
                // 빗맞혀 여백을 짚어도 반응으로 잡아야 '영역 외 터치'와
                // '무반응'이 구분된다 — 둘은 감별진단이 다르다.
                <div
                  className="flex-1 flex flex-col gap-4 min-h-0"
                  onPointerDown={actions.handleAreaPointerDown}
                >
                  <p className="text-center text-lg font-semibold text-primary">
                    지금 화면을 터치하세요
                  </p>
                  <LocTouchButton
                    isSelectable={isButtonEnabled}
                    onActivate={actions.handleButtonActivate}
                    buttonRef={touchButtonRef}
                  />
                  <LocProgressBar
                    isActive
                    remainingSeconds={remainingSeconds}
                    totalSeconds={10}
                  />
                </div>
              )}

              {/* 화면을 벗어나 시도가 중단됨 — 이 시도는 기록하지 않았다.
                  자동 재생하지 않고 환자가 준비됐을 때 다시 듣게 한다. */}
              {assessmentState === 'TRIAL_INTERRUPTED' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center">
                  <h2 className="text-2xl font-bold text-primary">
                    잠시 멈췄어요
                  </h2>
                  <p className="text-lg text-muted">
                    화면을 벗어나서 이번 문제는 다시 들려드릴게요.
                    <br />
                    앞서 하신 것은 그대로 남아 있어요.
                  </p>
                  <button
                    type="button"
                    onClick={actions.resumeInterruptedTrial}
                    className="min-h-[56px] rounded-full bg-primary px-8 text-lg font-bold text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark"
                  >
                    다시 듣기
                  </button>
                </div>
              )}

              {isProcessing && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
                  <div className="text-6xl" aria-hidden="true">✓</div>
                  <h2 className="text-2xl font-bold text-primary">확인했어요</h2>
                  <p className="text-lg text-muted">잠시만 기다려 주세요…</p>
                </div>
              )}
            </div>

            {/* 진행 결과 이력 (검사 진행 중, 있을 때만) */}
            {trialResults.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                <h3 className="font-semibold text-ink mb-2 text-sm">
                  진행 결과
                </h3>
                {trialResults.map((result) => (
                  <TrialResultRow key={result.trialNumber} result={result} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
