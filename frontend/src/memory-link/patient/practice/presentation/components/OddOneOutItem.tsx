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
      <p className="text-base text-muted-sage">{item.instruction}</p>

      {/*
        격자 폭을 묶는다. 화면 폭(max-w-2xl = 672px)을 다 쓰면 정사각 카드가
        324px가 되어 두 줄이 648px이고, 높이 720px 화면에서 아래 두 칸이 접힌
        곳 밑으로 사라진다.

        그림고르기라면 스크롤해서 찾으면 그만이지만 이 과제는 다르다. **넷을
        한눈에 비교하는 것이 과제 자체다.** 두 개만 보이면 "다른 하나"를 고를
        방법이 없다 — 어르신이 못 푸는 게 아니라 문항이 성립하지 않는다.

        440px면 카드가 약 214px이라 두 줄이 440px, 안내 문구와 진행 표시를
        더해도 접히지 않는다. 손가락 목표로도 여전히 크다.
      */}
      <div
        className="mx-auto grid w-full max-w-[440px] grid-cols-2 gap-3"
        role="group"
        aria-label="그림 선택지"
      >
        {item.choices.map((choice) => {
          const isChosen = selectedChoiceId === choice.choiceId;

          // 연습 규칙: 정답만 초록. 내가 고른 오답은 칠하지 않는다.
          let ring = 'border-line-soft';
          if (showAnswer) {
            ring = choice.isCorrect
              ? 'border-primary'
              : 'border-line-soft opacity-50';
          } else if (isChosen) {
            ring = 'border-primary';
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
              className={`relative aspect-square w-full overflow-hidden rounded-2xl border-4 bg-surface-dim transition-all duration-150 disabled:cursor-default ${ring} ${
                isSelectable ? 'hover:border-muted-faint active:scale-[0.97]' : ''
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
