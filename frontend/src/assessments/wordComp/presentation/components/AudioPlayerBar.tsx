/**
 * 단어 이해 (WordComp) 검사 - 오디오 재생 바 컴포넌트
 *
 * 단어 표시 + 오디오 재생 중 인디케이터 + 재청취 버튼을 제공한다.
 * 오디오 재생 중에는 재청취 버튼이 비활성화된다.
 */

import type React from 'react';
import { SpeakerIcon } from '../../../../shared/components/SpeakerIcon.js';

interface AudioPlayerBarProps {
  targetWord: string;
  isPlaying: boolean;
  isReplayEnabled: boolean;
  replayCount: number;
  onReplay: () => void;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  // targetWord는 정답 노출 방지를 위해 화면에 표시하지 않는다 (props 호환 유지)
  isPlaying,
  isReplayEnabled,
  replayCount,
  onReplay,
}) => {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-line px-6 py-4 flex items-center justify-between gap-4">
      {/* 단어 표시 영역 */}
      <div className="flex items-center gap-3 flex-1">
        {/* 오디오 재생 인디케이터 */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            isPlaying
              ? 'bg-primary animate-pulse'
              : 'bg-surface-dim'
          }`}
          aria-hidden="true"
        >
          <SpeakerIcon
            className={`w-5 h-5 ${isPlaying ? 'text-white' : 'text-muted-sage'}`}
          />
        </div>

        <div>
          <p className="text-xs text-muted-sage mb-0.5">
            {isPlaying ? '음성 재생 중...' : '음성 재생 완료'}
          </p>
          <p className="text-base font-semibold text-ink">
            단어를 듣고 그림을 선택하세요
          </p>
        </div>
      </div>

      {/* 재청취 버튼 */}
      <button
        type="button"
        className={`
          flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all
          ${
            isReplayEnabled
              ? 'bg-canvas text-muted-sage hover:bg-primary-light hover:text-primary border border-line'
              : 'bg-canvas text-muted-disabled cursor-not-allowed border border-line'
          }
        `}
        disabled={!isReplayEnabled}
        onClick={onReplay}
        aria-label="다시 듣기"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span>다시 듣기{replayCount > 0 ? ` (${replayCount})` : ''}</span>
      </button>
    </div>
  );
};
