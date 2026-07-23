// 4지선다 보기 카드 (단일 보기 1개)
//
// 피드백 색상(Plan §4):
//   정답: bg-[#EBF4F0] + border-[#2D6A56] + ✓
//   오답(사용자가 고른 것): bg-[#FBE9E2] + border-[#E07B54] + ✗
// 색상 단독 금지 → 아이콘 동반.

interface MultipleChoiceCardProps {
  /** 보기 텍스트 (= 제출값) */
  choice: string;
  /** 선택 가능 여부 (answering 단계에서만 true) */
  isSelectable: boolean;
  /** 사용자가 이 보기를 골랐는지 (피드백 단계) */
  isSelected: boolean;
  /** 피드백 단계 노출 여부 */
  showFeedback: boolean;
  /** 이 보기가 정답인지 (피드백 단계에서만 의미) */
  isCorrectAnswer: boolean;
  onSelect: (choice: string) => void;
}

/** 4지선다 카드 1개 */
export function MultipleChoiceCard({
  choice,
  isSelectable,
  isSelected,
  showFeedback,
  isCorrectAnswer,
  onSelect,
}: MultipleChoiceCardProps) {
  // 피드백 단계의 시각 상태 결정.
  let stateClass =
    'border-[#E5E5E0] bg-white text-[#1F2A26] hover:border-[#A8AFA9]';
  let icon: string | null = null;

  if (showFeedback) {
    if (isCorrectAnswer) {
      stateClass = 'border-[#2D6A56] bg-[#EBF4F0] text-[#1F5240]';
      icon = '✓';
    } else if (isSelected) {
      stateClass = 'border-[#E07B54] bg-[#FBE9E2] text-[#7A2E15]';
      icon = '✗';
    } else {
      stateClass = 'border-[#E5E5E0] bg-white text-[#9AA09B]';
    }
  } else if (isSelected) {
    stateClass = 'border-[#2D6A56] bg-[#EBF4F0] text-[#1F5240]';
  }

  return (
    <button
      type="button"
      disabled={!isSelectable}
      onClick={() => onSelect(choice)}
      aria-label={choice}
      aria-pressed={isSelected}
      className={`flex min-h-[64px] w-full items-center justify-between gap-3 rounded-md border-2 px-5 py-4 text-left text-xl font-medium transition-colors duration-[180ms] ease-out disabled:cursor-default ${stateClass}`}
    >
      <span>{choice}</span>
      {icon !== null && (
        <span className="text-2xl" aria-hidden="true">
          {icon}
        </span>
      )}
    </button>
  );
}
