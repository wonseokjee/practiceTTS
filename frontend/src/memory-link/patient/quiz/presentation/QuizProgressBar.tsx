// 퀴즈 진행 표시 바
//
// 접근성: role=progressbar + aria-valuenow/min/max.
// "n / total"은 tabular-nums로 폭 흔들림 방지.

interface QuizProgressBarProps {
  /** 1-based 현재 문제 번호 */
  current: number;
  /** 전체 문제 수 */
  total: number;
}

/**
 * 점(dot) + 텍스트로 진행 상황을 표시.
 * Warm Clinical: 진행 완료 sage(#2D6A56), 미진행 회색(#D4D8D4).
 */
export function QuizProgressBar({ current, total }: QuizProgressBarProps) {
  const safeTotal = total > 0 ? total : 1;
  const safeCurrent = Math.min(Math.max(current, 1), safeTotal);
  const dots = Array.from({ length: safeTotal }, (_, i) => i);

  return (
    <div
      className="mb-6 flex items-center justify-center gap-2"
      role="progressbar"
      aria-valuenow={safeCurrent}
      aria-valuemin={1}
      aria-valuemax={safeTotal}
      aria-label={`진행 ${safeCurrent} / ${safeTotal}`}
    >
      {dots.map((i) => (
        <span
          key={i}
          className={`block h-2.5 w-2.5 rounded-full transition-colors duration-[180ms] ease-out ${
            i < safeCurrent ? 'bg-[#2D6A56]' : 'bg-[#D4D8D4]'
          }`}
          aria-hidden="true"
        />
      ))}
      <span className="ml-3 text-sm tabular-nums text-[#5C6661]">
        {safeCurrent} / {safeTotal}
      </span>
    </div>
  );
}
