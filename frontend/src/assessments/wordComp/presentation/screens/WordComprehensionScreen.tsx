/**
 * 단어 이해 (WordComp) 검사 - 메인 화면 컴포넌트
 *
 * Composition Root 역할:
 * - SessionContext에서 patientId를 추출한다.
 * - useWordComprehensionViewModel을 호출하여 viewState와 actions를 획득한다.
 * - FSM phase에 따라 적절한 UI를 조건부 렌더링한다.
 *
 * 비즈니스 로직 없음: 모든 상태 전이와 비즈니스 규칙은 ViewModel 훅에 위임한다.
 *
 * phase별 렌더링:
 * - LOADING    : LoadingOverlay ("문항 불러오는 중...")
 * - PLAYING    : 헤더 + AudioPlayerBar(isPlaying=true) + ImageChoiceGrid(isSelectable=false)
 * - AWAITING   : 헤더 + AudioPlayerBar(isPlaying=false) + ImageChoiceGrid(isSelectable=true)
 * - SUBMITTING : 헤더 + AudioPlayerBar + ImageChoiceGrid(isSelectable=false)
 * - TRANSITIONING: 헤더 + 전환 중 표시
 * - COMPLETED  : SessionSummaryView + 다음 버튼
 * - ERROR      : 에러 메시지 + 재시도 버튼
 */

import type React from 'react';
import type { SessionSummaryDTO } from '../../application/dtos/SessionSummaryDTO.js';
import { useSessionContext } from '../../../../shared/session/SessionContext.js';
import { LoadingOverlay } from '../../../../shared/components/LoadingOverlay.js';
import { useWordComprehensionViewModel } from '../hooks/useWordComprehensionViewModel.js';
import { AudioPlayerBar } from '../components/AudioPlayerBar.js';
import { ImageChoiceGrid } from '../components/ImageChoiceGrid.js';
import { ItemProgressBar } from '../components/ItemProgressBar.js';
import { SessionSummaryView } from '../components/SessionSummaryView.js';

interface WordComprehensionScreenProps {
  onComplete?: (summary: SessionSummaryDTO) => void;
}

export const WordComprehensionScreen: React.FC<WordComprehensionScreenProps> = ({
  onComplete,
}) => {
  const { session, endSession } = useSessionContext();

  // session이 없으면 patientId를 알 수 없으므로 에러 상태 표시
  if (session === null) {
    return (
      <div className="h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-red-500 font-medium mb-4">
            세션 정보가 없습니다. 검사를 다시 시작해주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WordComprehensionScreenInner
      patientId={session.patientId}
      onComplete={onComplete}
      onEndSession={endSession}
    />
  );
};

interface InnerProps {
  patientId: string;
  onComplete?: (summary: SessionSummaryDTO) => void;
  onEndSession: () => void;
}

/**
 * 내부 컴포넌트: patientId가 확정된 후 ViewModel을 초기화한다.
 * 조건부 훅 호출 금지 원칙을 준수하기 위해 분리하였다.
 */
const WordComprehensionScreenInner: React.FC<InnerProps> = ({
  patientId,
  onComplete,
  onEndSession,
}) => {
  const { viewState, actions } = useWordComprehensionViewModel(
    patientId,
    onComplete,
  );

  const {
    phase,
    currentItemIndex,
    totalItems,
    currentItem,
    isSelectable,
    isAudioPlaying,
    replayCount,
    summary,
    errorMessage,
  } = viewState;

  const { onChoiceSelected, onReplayRequested, onRetry } = actions;

  // LOADING: 문항 불러오는 중
  if (phase.type === 'LOADING') {
    return (
      <div className="h-full bg-gray-50 flex items-center justify-center">
        <LoadingOverlay message="문항 불러오는 중..." />
      </div>
    );
  }

  // COMPLETED: 검사 완료 - 요약 결과 표시
  if (phase.type === 'COMPLETED') {
    return (
      <div className="h-full bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm">
          <div>
            <h1 className="text-base font-semibold text-gray-800">
              단어 이해 검사
            </h1>
            <p className="text-xs text-gray-400">검사 완료</p>
          </div>
          <span className="text-xs text-gray-400">환자 ID: {patientId}</span>
        </header>
        <main className="flex-1 px-4 py-4 max-w-xl mx-auto w-full overflow-y-auto">
          {summary !== null ? (
            <SessionSummaryView summary={summary} onProceed={onComplete !== undefined ? () => onComplete(summary) : undefined} />
          ) : (
            <LoadingOverlay message="결과 집계 중..." />
          )}
        </main>
      </div>
    );
  }

  // ERROR: 오류 발생
  if (phase.type === 'ERROR') {
    return (
      <div className="h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center px-6 max-w-sm w-full">
          <div
            className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"
            aria-hidden="true"
          >
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p className="text-gray-700 font-medium mb-2">오류가 발생했습니다</p>
          <p className="text-gray-500 text-sm mb-6">
            {errorMessage ?? phase.message}
          </p>
          <button
            type="button"
            className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors"
            onClick={onRetry}
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // TRANSITIONING: 다음 문항으로 전환 중
  if (phase.type === 'TRANSITIONING') {
    return (
      <div className="h-full bg-gray-50 flex flex-col">
        <AssessmentHeader
          patientId={patientId}
          currentItemIndex={currentItemIndex}
          totalItems={totalItems}
          onEndSession={onEndSession}
        />
        <main className="flex-1 px-4 py-4 max-w-xl mx-auto w-full flex items-center justify-center">
          <LoadingOverlay message="다음 문항으로 이동 중..." />
        </main>
      </div>
    );
  }

  // PLAYING / AWAITING / SUBMITTING: 검사 진행 중
  // currentItem이 없으면 렌더링 불가 (LOADING 이후 반드시 설정됨)
  if (currentItem === null) {
    return (
      <div className="h-full bg-gray-50 flex items-center justify-center">
        <LoadingOverlay message="문항 불러오는 중..." />
      </div>
    );
  }

  const isSubmitting = phase.type === 'SUBMITTING';

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      <AssessmentHeader
        patientId={patientId}
        currentItemIndex={currentItemIndex}
        totalItems={totalItems}
        onEndSession={onEndSession}
      />

      <main className="flex-1 px-4 py-4 max-w-xl mx-auto w-full flex flex-col gap-4 overflow-y-auto min-h-0">
        {/* 문항 진행 바 */}
        <ItemProgressBar
          current={currentItemIndex + 1}
          total={totalItems}
        />

        {/* 오디오 재생 바 */}
        <AudioPlayerBar
          targetWord={currentItem.targetWord}
          isPlaying={isAudioPlaying}
          isReplayEnabled={phase.type === 'AWAITING'}
          replayCount={replayCount}
          onReplay={onReplayRequested}
        />

        {/* 이미지 선택지 그리드 */}
        <ImageChoiceGrid
          choices={currentItem.choices}
          isSelectable={isSelectable}
          onSelect={onChoiceSelected}
        />

        {/* 제출 중 오버레이 표시 */}
        {isSubmitting && (
          <div
            className="flex items-center justify-center gap-2 py-2 text-blue-500 text-sm"
            role="status"
            aria-live="polite"
          >
            <div
              className="w-4 h-4 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin"
              aria-hidden="true"
            />
            <span>처리 중...</span>
          </div>
        )}
      </main>
    </div>
  );
};

/** 검사 화면 공통 헤더 */
interface AssessmentHeaderProps {
  patientId: string;
  currentItemIndex: number;
  totalItems: number;
  onEndSession: () => void;
}

const AssessmentHeader: React.FC<AssessmentHeaderProps> = ({
  patientId,
  currentItemIndex,
  totalItems,
  onEndSession,
}) => {
  return (
    <header className="bg-white border-b border-gray-100 px-4 py-3 shadow-sm">
      <div className="max-w-xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-800">
            단어 이해 검사
          </h1>
          <p className="text-xs text-gray-400">
            QAB 하위검사 3번 &nbsp;·&nbsp; 환자 ID: {patientId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 hidden sm:inline">
            {currentItemIndex + 1} / {totalItems}
          </span>
          <button
            type="button"
            className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            onClick={onEndSession}
            aria-label="검사 세션 종료"
          >
            세션 종료
          </button>
        </div>
      </div>
    </header>
  );
};
