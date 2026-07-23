/**
 * TTS 재생 중 표시 컴포넌트
 *
 * isTtsPlaying이 true일 때만 렌더링된다.
 * 음파 애니메이션으로 재생 중임을 시각적으로 표시한다.
 */

interface LocAudioIndicatorProps {
  isTtsPlaying: boolean;
}

export function LocAudioIndicator({ isTtsPlaying }: LocAudioIndicatorProps) {
  return (
    <div
      className={`flex flex-col items-center gap-3 ${isTtsPlaying ? '' : 'invisible'}`}
      role="status"
      aria-live="polite"
      aria-label="음성 안내 재생 중"
    >
      {/* 음파 애니메이션 */}
      <div className="flex items-end gap-1 h-10">
        {[1, 2, 3, 4, 5].map((bar) => (
          <div
            key={bar}
            className="w-2 bg-[#2D6A56] rounded-full animate-pulse"
            style={{
              height: `${20 + (bar % 3) * 12}px`,
              animationDelay: `${bar * 0.1}s`,
              animationDuration: '0.8s',
            }}
          />
        ))}
      </div>

      <p className="text-[#2D6A56] font-semibold text-lg">
        음성 안내 재생 중...
      </p>
    </div>
  );
}
