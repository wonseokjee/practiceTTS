/**
 * 문장 오디오 재생 표시 컴포넌트
 *
 * 현재 재생 중인 문장 텍스트를 표시하고,
 * 재청취 버튼은 AWAITING 상태(isReplayEnabled=true)에서만 활성화된다.
 * 재생 중에는 애니메이션 표시로 상태를 알린다.
 */

import type React from 'react';

interface SentenceAudioPlayerProps {
  /** 재생할 문장 텍스트 */
  sentence: string;
  /** 현재 오디오 재생 중 여부 */
  isPlaying: boolean;
  /** 재청취 버튼 활성화 여부 (AWAITING 상태에서만 true) */
  isReplayEnabled: boolean;
  /** 재청취 버튼 클릭 핸들러 */
  onReplay: () => void;
}

export const SentenceAudioPlayer: React.FC<SentenceAudioPlayerProps> = ({
  sentence,
  isPlaying,
  isReplayEnabled,
  onReplay,
}) => {
  return (
    <div
      className="bg-white rounded-2xl shadow-sm border border-[#E8E4DC] p-6 flex flex-col items-center gap-4"
      aria-label="문장 오디오 재생 영역"
    >
      {/* 오디오 재생 상태 표시 */}
      <div className="flex items-center gap-3">
        {/* 재생 중 애니메이션 아이콘 */}
        <div
          className={`flex items-end gap-1 h-8 ${isPlaying ? 'opacity-100' : 'opacity-30'}`}
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-1.5 bg-[#2D6A56] rounded-full ${
                isPlaying ? 'animate-bounce' : ''
              }`}
              style={{
                height: `${[16, 24, 20, 12][i]}px`,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>

        {/* 상태 텍스트 */}
        <span
          className={`text-sm font-medium ${
            isPlaying ? 'text-[#2D6A56]' : 'text-[#9AA09B]'
          }`}
          aria-live="polite"
        >
          {isPlaying ? '재생 중...' : '재생 완료'}
        </span>
      </div>

      {/* 문장 표시 */}
      <p
        className="text-xl font-medium text-[#1A1916] text-center leading-relaxed"
        aria-label={`문장: ${sentence}`}
      >
        {sentence}
      </p>

      {/* 다시 듣기 버튼 */}
      <button
        type="button"
        className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
          isReplayEnabled
            ? 'bg-[#EBF4F0] text-[#2D6A56] hover:bg-[#dcebe4] active:scale-95 cursor-pointer'
            : 'bg-[#F7F6F3] text-[#9AA09B] cursor-not-allowed'
        }`}
        onClick={onReplay}
        disabled={!isReplayEnabled}
        aria-label="문장 다시 듣기"
      >
        다시 듣기
      </button>
    </div>
  );
};
