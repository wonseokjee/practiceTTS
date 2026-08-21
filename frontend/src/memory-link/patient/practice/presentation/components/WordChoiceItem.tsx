// 낱말 고르기 — 그림 하나, 낱말 여러 개
//
// 그림고르기(ImageChoiceQuizItem)는 검사와 공유하는 컴포넌트라 `answerOnly`
// 같은 선택 prop으로 연습 동작을 얹어야 했다. 이건 연습 전용이라 처음부터
// 연습 규칙 하나만 갖는다 — **정답만 표시하고 오답은 칠하지 않는다.**
//
// 소리는 쓰지 않는다. 낱말을 읽어주면 그게 곧 정답이다.

import type { PracticeWordChoiceItem } from '../../domain/practiceWordChoice.js';

interface WordChoiceItemProps {
  item: PracticeWordChoiceItem;
  isSelectable: boolean;
  /** 정답 공개 단계인가 */
  showAnswer: boolean;
  /** 마지막으로 누른 선택지 */
  selectedChoiceId: string | null;
  onSelect: (choiceId: string) => void;
}

export function WordChoiceItem({
  item,
  isSelectable,
  showAnswer,
  selectedChoiceId,
  onSelect,
}: WordChoiceItemProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-[#5C6661]">{item.instruction}</p>

      {/*
        그림은 정사각 카드 하나. 그림고르기의 2×2 격자와 높이를 비슷하게 두면
        문항이 바뀔 때 화면이 크게 출렁이지 않는다.
      */}
      <div className="mx-auto w-full max-w-[280px]">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl border-4 border-[#E5E5E0] bg-[#F2F1ED]">
          <img
            src={item.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3" role="group" aria-label="낱말 선택지">
        {item.choices.map((choice) => {
          const isChosen = selectedChoiceId === choice.choiceId;

          // 연습 규칙: 정답만 초록. 내가 고른 오답에는 아무 표시도 하지 않는다.
          let style = 'border-[#E5E5E0] bg-white text-[#1F2A26]';
          if (showAnswer) {
            style = choice.isCorrect
              ? 'border-[#2D6A56] bg-[#EBF4F0] text-[#1F5240]'
              : 'border-[#E5E5E0] bg-white text-[#1F2A26] opacity-50';
          } else if (isChosen) {
            style = 'border-[#2D6A56] bg-white text-[#1F2A26]';
          }

          return (
            <button
              key={choice.choiceId}
              type="button"
              disabled={!isSelectable}
              onClick={() => {
                if (isSelectable) onSelect(choice.choiceId);
              }}
              aria-label={`${choice.label} 선택`}
              className={`min-h-[56px] w-full rounded-2xl border-4 px-5 py-3 text-xl font-medium transition-all duration-150 disabled:cursor-default ${style} ${
                isSelectable ? 'hover:border-[#A8AFA9] active:scale-[0.99]' : ''
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
