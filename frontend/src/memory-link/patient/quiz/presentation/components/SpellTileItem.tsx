// QAB 글자 조합(검사 `spell`) 문항 — 그림을 보고 음절 타일로 낱말을 만든다.
//
// 그림을 함께 보여주는 게 설계의 핵심이다. 그림 없이 타일만 주면 "무슨 낱말을
// 만들어야 하는지"부터 알아내야 해서 회상 과제가 되고, 틀렸을 때 회상 실패인지
// 조합 실패인지 분리되지 않는다(예전 기억 기반 타일 문항이 그랬다).
// 그림 + 글자 조합은 ACT(Anagram and Copy Treatment) 계열의 written naming
// 형태이기도 하다.
//
// 조합 입력 자체는 데일리 퀴즈와 같은 TileArrangeInput을 재사용한다.

import type { QabSpellItem } from '../../domain/MixedQuiz.js';
import { TileArrangeInput } from './TileArrangeInput.js';

interface SpellTileItemProps {
  item: QabSpellItem;
  isSelectable: boolean;
  showFeedback: boolean;
  /** 채점 결과 — 피드백 단계에서만 의미 */
  isCorrect: boolean | null;
  onSubmit: (assembled: string) => void;
  /** 보호자가 옆에서 통과 처리 (막히지 않게) */
  onSkip: () => void;
}

export function SpellTileItem({
  item,
  isSelectable,
  showFeedback,
  isCorrect,
  onSubmit,
  onSkip,
}: SpellTileItemProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-[#5C6661]">{item.instruction}</p>

      {/* 만들 낱말의 그림 단서 */}
      <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border-4 border-[#E5E5E0] bg-[#F2F1ED]">
        <div
          className="absolute inset-0 flex items-center justify-center text-4xl"
          aria-hidden="true"
          style={{ zIndex: 0 }}
        >
          🖼️
        </div>
        <img
          src={item.imageUrl}
          alt="낱말을 만들 그림"
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          style={{ zIndex: 1 }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>

      <TileArrangeInput
        tiles={item.tiles}
        isSelectable={isSelectable}
        showFeedback={showFeedback}
        isCorrect={isCorrect}
        correctAnswer={showFeedback ? item.targetWord : null}
        // 첫 글자 힌트는 주지 않는다. 타일에 정답 음절이 이미 다 들어 있어
        // 힌트까지 주면 레벨 1~2(방해 0개)에서는 사실상 정답을 알려주는 셈이다.
        hintFirstChar={null}
        onSubmit={onSubmit}
      />

      {!showFeedback && (
        <button
          type="button"
          onClick={onSkip}
          disabled={!isSelectable}
          className="min-h-[48px] rounded-md bg-white px-5 py-3 text-base font-medium text-[#5C6661] ring-1 ring-inset ring-[#D4D8D4] transition-colors duration-[180ms] ease-out hover:bg-[#EBEAE6] disabled:cursor-not-allowed disabled:text-[#C5C8C5]"
          aria-label="넘어가기"
        >
          넘어가기
        </button>
      )}
    </div>
  );
}
