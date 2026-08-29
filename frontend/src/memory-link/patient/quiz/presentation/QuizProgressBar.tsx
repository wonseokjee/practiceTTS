// 퀴즈 진행 표시 바
//
// **점 대신 연속 막대다.** 예전에는 문항 수만큼 점을 찍었다. 로테이션(#74)으로
// 세션이 11문항으로 고정되면서 점이 11개가 됐는데, 각 점이 10px이고 간격까지
// 더하면 390px 화면의 절반을 쓴다. 그러면서 정작 "몇 개 남았나"는 못 알려준다 —
// 사람이 한눈에 세는 한계가 4~5개라 11개는 세어지지 않는다. 점의 유일한 장점
// (낱개가 보인다)이 그 개수에서 사라진 것이다.
//
// 막대는 개수에 상관없이 같은 크기로 비율을 보여주고, 옆의 `n / total`이 정확한
// 수를 맡는다. 둘은 중복이 아니라 역할이 다르다 — 막대는 훑어보는 눈에, 숫자는
// 세어보는 눈에.
//
// 접근성: role=progressbar + aria-valuenow/min/max.
// "n / total"은 tabular-nums로 폭 흔들림 방지.

interface QuizProgressBarProps {
  /** 1-based 현재 문제 번호 */
  current: number;
  /** 전체 문제 수 */
  total: number;
}

export function QuizProgressBar({ current, total }: QuizProgressBarProps) {
  const safeTotal = total > 0 ? total : 1;
  const safeCurrent = Math.min(Math.max(current, 1), safeTotal);
  const percent = Math.round((safeCurrent / safeTotal) * 100);

  return (
    <div className="mb-6 flex items-center gap-3">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[#D4D8D4]"
        role="progressbar"
        aria-valuenow={safeCurrent}
        aria-valuemin={1}
        aria-valuemax={safeTotal}
        aria-label={`진행 ${safeCurrent} / ${safeTotal}`}
      >
        <div
          className="h-full rounded-full bg-[#2D6A56] transition-[width] duration-[250ms] ease-in-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 text-sm tabular-nums text-[#5C6661]">
        {safeCurrent} / {safeTotal}
      </span>
    </div>
  );
}
