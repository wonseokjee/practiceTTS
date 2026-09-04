// 문항 진행 표시 바 — **앱에 하나뿐인 진행 바다.**
//
// 예전에는 같은 일을 하는 컴포넌트가 셋이었다(`QuizProgressBar`,
// `AssessmentProgressBar`, wordComp의 `ItemProgressBar`). 셋이 조금씩 달랐고,
// 그중 둘은 `n / total` + **`%`** + 막대로 같은 값을 세 번 적었다. 퍼센트는
// 막대가 이미 보여주는 것을 숫자로 옮긴 것뿐이라 새로 알려주는 게 없다.
//
// **점 대신 연속 막대다.** 예전에는 문항 수만큼 점을 찍었다. 로테이션(#74)으로
// 세션이 11문항으로 고정되면서 점이 11개가 됐는데, 각 점이 10px이고 간격까지
// 더하면 390px 화면의 절반을 쓴다. 그러면서 정작 "몇 개 남았나"는 못 알려준다 —
// 사람이 한눈에 세는 한계가 4~5개라 11개는 세어지지 않는다. 점의 유일한 장점
// (낱개가 보인다)이 그 개수에서 사라진 것이다.
//
// 막대는 개수에 상관없이 같은 크기로 비율을 보여주고, 옆의 `n / total`이 정확한
// 수를 맡는다. 둘은 중복이 아니라 역할이 다르다 — 막대는 훑어보는 눈에, 숫자는
// 세어보는 눈에. **여기에 `%`를 다시 넣지 말 것.**
//
// 바깥 여백은 두지 않는다. 놓이는 화면마다 간격 방식이 달라서(퀴즈는 `mb-6`,
// 검사 화면은 부모의 `gap-4`) 컴포넌트가 정하면 한쪽이 늘 어긋난다.
//
// 카운트다운 바(`LocProgressBar`)는 여기 합치지 않았다. 남은 **초**를 세고
// 긴박도에 따라 색이 바뀌는 다른 과제다.
//
// 접근성: role=progressbar + aria-valuenow/min/max.
// "n / total"은 tabular-nums로 폭 흔들림 방지.

interface ItemProgressBarProps {
  /** 1-based 현재 문제 번호 */
  current: number;
  /** 전체 문제 수 */
  total: number;
}

export function ItemProgressBar({ current, total }: ItemProgressBarProps) {
  const safeTotal = total > 0 ? total : 1;
  const safeCurrent = Math.min(Math.max(current, 1), safeTotal);
  const percent = Math.round((safeCurrent / safeTotal) * 100);

  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-line-strong"
        role="progressbar"
        aria-valuenow={safeCurrent}
        aria-valuemin={1}
        aria-valuemax={safeTotal}
        aria-label={`진행 ${safeCurrent} / ${safeTotal}`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-[250ms] ease-in-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted-sage">
        {safeCurrent} / {safeTotal}
      </span>
    </div>
  );
}
