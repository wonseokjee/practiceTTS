/**
 * 카운트다운 진행 바 컴포넌트
 *
 * AWAITING_TOUCH 상태에서만 활성화된다.
 * 10초 타임아웃을 시각적으로 표시한다.
 */

interface LocProgressBarProps {
  isActive: boolean;
  remainingSeconds: number;
  totalSeconds?: number;
}

export function LocProgressBar({
  isActive,
  remainingSeconds,
  totalSeconds = 10,
}: LocProgressBarProps) {
  const progress = isActive ? (remainingSeconds / totalSeconds) * 100 : 100;

  // 남은 시간에 따른 색상 전환
  const barColorClass =
    remainingSeconds > 5
      ? 'bg-primary'
      : remainingSeconds > 2
        ? 'bg-warning'
        : 'bg-danger';

  return (
    <div
      className={`w-full flex flex-col items-center gap-2 ${isActive ? '' : 'invisible'}`}
      role="timer"
      aria-label={`남은 시간 ${remainingSeconds}초`}
      aria-live="polite"
    >
      {/* 남은 시간 텍스트 */}
      <p className="text-2xl font-bold text-ink">
        {remainingSeconds}
        <span className="text-base font-normal text-muted ml-1">초</span>
      </p>

      {/* 진행 바 */}
      <div className="w-full h-4 bg-line rounded-full overflow-hidden">
        <div
          className={`h-full ${barColorClass} rounded-full transition-all duration-1000 ease-linear`}
          style={{ width: `${Math.max(0, progress)}%` }}
        />
      </div>
    </div>
  );
}
