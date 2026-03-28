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

import type React from 'react';
import { useSessionContext } from '../../../shared/session/SessionContext.js';
import { useSentCompViewModel } from './useSentCompViewModel.js';
import { SentenceAudioPlayer } from './components/SentenceAudioPlayer.js';
import { ImageChoiceGrid } from './components/ImageChoiceGrid.js';
import { ScoreResultPanel } from './components/ScoreResultPanel.js';
import { AssessmentProgressBar } from '../../../shared/components/AssessmentProgressBar.js';
import { LoadingOverlay } from '../../../shared/components/LoadingOverlay.js';
import type { ScoreDTO } from '../application/dtos.js';

interface SentCompScreenProps {
  onComplete?: (score: ScoreDTO) => void;
}

export function SentCompScreen({ onComplete }: SentCompScreenProps) {
  const { session, endSession } = useSessionContext();
  const sessionId = session?.sessionId ?? '';
  const patientId = session?.patientId ?? '';

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
    <div className="h-full bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white shadow-sm px-6 py-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            문장 이해 (SentComp) 검사
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            환자:{' '}
            <span className="font-medium text-gray-700">{patientId}</span>
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
          <LoadingOverlay message="채점 중..." />
        )}

        {/* ERROR 상태 */}
        {phase.type === 'ERROR' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div
              className="bg-red-50 border border-red-200 rounded-xl px-6 py-4 text-red-700 text-center w-full"
              role="alert"
            >
              <p className="font-medium mb-1">오류 발생</p>
              <p className="text-sm">{errorMessage ?? phase.message}</p>
            </div>
            <button
              type="button"
              className="px-8 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors"
              onClick={actions.handleRetry}
            >
              다시 시도
            </button>
          </div>
        )}

        {/* LOADING 상태 */}
        {phase.type === 'LOADING' && (
          <LoadingOverlay message="문항을 불러오는 중..." />
        )}

        {/* TRANSITIONING 상태 */}
        {phase.type === 'TRANSITIONING' && (
          <LoadingOverlay message="다음 문항 준비 중..." />
        )}

        {/* PLAYING / AWAITING / SUBMITTING / FEEDBACK 상태 */}
        {(phase.type === 'PLAYING' ||
          phase.type === 'AWAITING' ||
          phase.type === 'SUBMITTING' ||
          phase.type === 'FEEDBACK') &&
          currentItem !== null && (
            <>
              {/* 진행 바 */}
              <AssessmentProgressBar
                current={currentItemIndex + 1}
                total={totalItems > 0 ? totalItems : 10}
              />

              {/* FEEDBACK 오버레이 */}
              {phase.type === 'FEEDBACK' && (
                <div
                  className={`rounded-xl px-6 py-3 text-center font-semibold text-lg ${
                    feedbackIsCorrect
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}
                  role="status"
                  aria-live="assertive"
                >
                  {feedbackIsCorrect ? '정답입니다!' : '오답입니다.'}
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
                  className="text-center text-sm text-gray-400 py-2"
                  aria-live="polite"
                >
                  처리 중...
                </div>
              )}
            </>
          )}
      </main>
    </div>
  );
}
