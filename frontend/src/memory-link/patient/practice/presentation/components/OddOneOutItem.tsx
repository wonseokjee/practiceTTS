// 무리에서 빼기 렌더러 — 그림 4개, 소리 없음
//
// 그림고르기와 겉모습이 비슷한 2×2 격자지만 듣기 버튼이 없다. 자극이 소리가
// 아니라 **네 그림의 관계**이기 때문이다. 안내 문구가 곧 과제 전부다.
//
// 라벨은 화면에 쓰지 않는다. 낱말을 읽을 수 있으면 범주를 글자로 풀 수 있어
// 그림으로 묶는 과제가 아니게 된다. 스크린리더용 이름으로만 남긴다.

import type { PracticeOddOneOutItem } from '../../domain/practiceOddOneOut.js';

interface OddOneOutItemProps {
  item: PracticeOddOneOutItem;
  isSelectable: boolean;
  showAnswer: boolean;
  selectedChoiceId: string | null;
  onSelect: (choiceId: string) => void;
}

export function OddOneOutItem({
  item,
  isSelectable,
  showAnswer,
  selectedChoiceId,
  onSelect,
}: OddOneOutItemProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-[#5C6661]">{item.instruction}</p>

      <div className="grid grid-cols-2 gap-3" role="group" aria-label="그림 선택지">
        {item.choices.map((choice) => {
          const isChosen = selectedChoiceId === choice.choiceId;

          // 연습 규칙: 정답만 초록. 내가 고른 오답은 칠하지 않는다.
          let ring = 'border-[#E5E5E0]';
          if (showAnswer) {
            ring = choice.isCorrect
              ? 'border-[#2D6A56]'
              : 'border-[#E5E5E0] opacity-50';
          } else if (isChosen) {
            ring = 'border-[#2D6A56]';
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
              className={`relative aspect-square w-full overflow-hidden rounded-2xl border-4 bg-[#F2F1ED] transition-all duration-150 disabled:cursor-default ${ring} ${
                isSelectable ? 'hover:border-[#A8AFA9] active:scale-[0.97]' : ''
              }`}
            >
              <img
                src={choice.imageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                loading="eager"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
