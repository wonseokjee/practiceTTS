/**
 * 문장 이해 (SentComp) 검사 화면
 *
 * 역할:
 * 1. useSentCompViewModel을 호출하여 상태와 액션을 받는다.
 * 2. FSM 상태(phase)에 따라 적절한 컴포넌트를 렌더링한다.
 * 3. SessionContext에서 sessionId를 획득한다.
 *
 * 비즈니스 로직은 useSentCompViewModel에만 존재한다.
 * 이 컴포넌트는 순수한 렌더링만 담당한다.
 */

import { useTranslation } from 'react-i18next';
import { useSessionContext } from '../../../shared/session/SessionContext.js';
import { useSentCompViewModel } from './useSentCompViewModel.js';
import { SentenceAudioPlayer } from './components/SentenceAudioPlayer.js';
import { ImageChoiceGrid } from './components/ImageChoiceGrid.js';
import { ScoreResultPanel } from './components/ScoreResultPanel.js';
import { ItemProgressBar } from '../../../shared/components/ItemProgressBar.js';
import { LoadingOverlay } from '../../../shared/components/LoadingOverlay.js';
import type { ScoreDTO } from '../application/dtos.js';

interface SentCompScreenProps {
  onComplete?: (score: ScoreDTO) => void;
}

export function SentCompScreen({ onComplete }: SentCompScreenProps) {
  const { t } = useTranslation('assessments');
  const { session, endSession } = useSessionContext();
  const sessionId = session?.sessionId ?? '';
  const patientId = session?.patientId ?? '';
  // 표시용 환자 이름 (없으면 식별자로 폴백)
  const patientLabel = session?.patientName ?? patientId;

  const handleComplete = (scoreResult: ScoreDTO) => {
    onComplete?.(scoreResult);
  };

  const { viewState, actions } = useSentCompViewModel(sessionId, handleComplete);

  const {
    phase,
    currentItem,
    currentItemIndex,
    totalItems,
    score,
    errorMessage,
    selectedIndex,
  } = viewState;

  const isPlaying = phase.type === 'PLAYING';
  const isAwaiting = phase.type === 'AWAITING';
  const isSelectable = isAwaiting;

  // FEEDBACK 상태에서의 정오 정보
  const feedbackIsCorrect =
    phase.type === 'FEEDBACK' ? phase.isCorrect : null;

  return (
    <div className="h-full bg-canvas flex flex-col">
      {/* 헤더 */}
      <header className="bg-white shadow-sm px-6 py-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">{t('sentComp.screen.title')}</h1>
          <p className="text-sm text-muted-sage mt-1">
            {t('sentComp.screen.patientPrefix')}{' '}
            <span className="font-medium text-ink">{patientLabel}</span>
          </p>
        </div>
        <button
          type="button"
          className="text-xs text-muted-sage hover:text-danger transition-colors mt-1"
          onClick={endSession}
        >
          {t('sentComp.screen.endSessionButton')}
        </button>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 flex flex-col px-6 py-4 gap-4 max-w-lg mx-auto w-full overflow-y-auto min-h-0">
        {/* COMPLETED 상태: 채점 결과 패널 */}
        {phase.type === 'COMPLETED' && score !== null && (
          <ScoreResultPanel
            score={score}
            onProceed={() => {
              onComplete?.(score);
            }}
          />
        )}

        {/* COMPLETED이지만 score 아직 미계산 */}
        {phase.type === 'COMPLETED' && score === null && (
          <LoadingOverlay message={t('sentComp.screen.scoringLabel')} />
        )}

        {/* ERROR 상태 */}
        {phase.type === 'ERROR' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div
              className="bg-danger/10 border border-danger/30 rounded-xl px-6 py-4 text-danger text-center w-full"
              role="alert"
            >
              <p className="font-medium mb-1">{t('sentComp.screen.errorTitle')}</p>
              <p className="text-sm">{errorMessage ?? phase.message}</p>
            </div>
            <button
              type="button"
              className="px-8 py-3 bg-primary hover:bg-primary-dark text-white font-medium rounded-xl transition-colors"
              onClick={actions.handleRetry}
            >
              {t('sentComp.screen.retryButton')}
            </button>
          </div>
        )}

        {/* LOADING 상태 */}
        {phase.type === 'LOADING' && (
          <LoadingOverlay message={t('sentComp.screen.loadingItems')} />
        )}

        {/* TRANSITIONING 상태 */}
        {phase.type === 'TRANSITIONING' && (
          <LoadingOverlay message={t('sentComp.screen.preparingNextItem')} />
        )}

        {/* PLAYING / AWAITING / SUBMITTING / FEEDBACK 상태 */}
        {(phase.type === 'PLAYING' ||
          phase.type === 'AWAITING' ||
          phase.type === 'SUBMITTING' ||
          phase.type === 'FEEDBACK') &&
          currentItem !== null && (
            <>
              {/* 진행 바 */}
              <ItemProgressBar
                current={currentItemIndex + 1}
                total={totalItems > 0 ? totalItems : 10}
              />

              {/* FEEDBACK 오버레이 */}
              {phase.type === 'FEEDBACK' && (
                <div
                  className={`rounded-xl px-6 py-3 text-center font-semibold text-lg ${
                    feedbackIsCorrect
                      ? 'bg-primary-light text-primary border border-primary/25'
                      : 'bg-danger/10 text-danger border border-danger/30'
                  }`}
                  role="status"
                  aria-live="assertive"
                >
                  {feedbackIsCorrect
                    ? t('sentComp.screen.correctFeedback')
                    : t('sentComp.screen.incorrectFeedback')}
                </div>
              )}

              {/* 오디오 재생 컴포넌트 */}
              <SentenceAudioPlayer
                sentence={currentItem.sentence}
                isPlaying={isPlaying}
                isReplayEnabled={isAwaiting}
                onReplay={actions.handleReplay}
              />

              {/* 이미지 선택지 */}
              <ImageChoiceGrid
                choices={currentItem.choices}
                isSelectable={isSelectable}
                selectedIndex={selectedIndex}
                onSelect={actions.handleImageSelect}
              />

              {/* SUBMITTING 처리 중 표시 */}
              {phase.type === 'SUBMITTING' && (
                <div
                  className="text-center text-sm text-muted-sage py-2"
                  aria-live="polite"
                >
                  {t('sentComp.screen.submittingLabel')}
                </div>
              )}
            </>
          )}
      </main>
    </div>
  );
}
