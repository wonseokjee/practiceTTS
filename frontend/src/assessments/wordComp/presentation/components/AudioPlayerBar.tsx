/**
 * 단어 이해 (WordComp) 검사 - 오디오 재생 바 컴포넌트
 *
 * 단어 표시 + 오디오 재생 중 인디케이터 + 재청취 버튼을 제공한다.
 * 오디오 재생 중에는 재청취 버튼이 비활성화된다.
 */

import type React from 'react';

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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4 flex items-center justify-between gap-4">
      {/* 단어 표시 영역 */}
      <div className="flex items-center gap-3 flex-1">
        {/* 오디오 재생 인디케이터 */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            isPlaying
              ? 'bg-blue-500 animate-pulse'
              : 'bg-gray-100'
          }`}
          aria-hidden="true"
        >
          <svg
            className={`w-5 h-5 ${isPlaying ? 'text-white' : 'text-gray-400'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.786L4.17 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.17l4.213-3.786a1 1 0 011 .076zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-0.5">
            {isPlaying ? '음성 재생 중...' : '음성 재생 완료'}
          </p>
          <p className="text-base font-semibold text-gray-700">
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
              ? 'bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-blue-600 border border-gray-200'
              : 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-100'
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
