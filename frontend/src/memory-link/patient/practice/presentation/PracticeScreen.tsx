// 연습 모드 화면
//
// **검사 화면(QuizScreen)과 가장 크게 다른 점: 피드백 단계가 없다.**
//
// QuizScreen은 답을 내면 'feedback' 단계로 가서 "정답이에요!/아쉬워요"를 띄우고
// 정답 카드를 초록으로 칠한다. 연습은 그 단계 자체가 없다 — 문항 컴포넌트에
// `showFeedback={false}`를 고정으로 넘겨 정오답 표시 경로를 아예 안 탄다.
//
// 답한 뒤 보여주는 문구는 **정오답과 무관하게 항상 같다.** 늘 같은 말이므로
// 맞았는지에 대한 정보를 전혀 담지 않는다. 연습에서 격려하는 대상은 답이
// 아니라 연습했다는 사실이다.

import type { PracticePlayable } from '../domain/Practice.js';
import {
  usePracticeSession,
  type UsePracticeDeps,
} from '../application/usePracticeSession.js';
import { QuizProgressBar } from '../../quiz/presentation/QuizProgressBar.js';
import { ImageChoiceQuizItem } from '../../quiz/presentation/components/ImageChoiceQuizItem.js';
import { SpellTileItem } from '../../quiz/presentation/components/SpellTileItem.js';

interface PracticeScreenProps {
  /** 세션을 마치거나 그만둘 때 호출 */
  onExit: () => void;
  /** 테스트용 의존성 주입 (선택) */
  deps?: UsePracticeDeps;
}

/** 문항 종류별 렌더 — 어느 갈래도 판정을 그리지 않는다. */
function PracticeItemBody({
  playable,
  isSelectable,
  selectedValue,
  onAnswer,
  onSkip,
}: {
  playable: PracticePlayable;
  isSelectable: boolean;
  selectedValue: string | null;
  onAnswer: (value: string) => void;
  onSkip: () => void;
}) {
  switch (playable.kind) {
    case 'imageChoice':
      return (
        <ImageChoiceQuizItem
          item={playable.item}
          isSelectable={isSelectable}
          // 연습은 정답/오답을 칠하지 않는다. 고른 카드만 표시된다.
          showFeedback={false}
          selectedChoiceId={selectedValue}
          onSelect={onAnswer}
        />
      );
    case 'spell':
      return (
        <SpellTileItem
          item={playable.item}
          isSelectable={isSelectable}
          showFeedback={false}
          isCorrect={null}
          onSubmit={onAnswer}
          onSkip={onSkip}
        />
      );
  }
}

export function PracticeScreen({ onExit, deps }: PracticeScreenProps) {
  const [state, actions] = usePracticeSession(deps);
  const { phase, currentItem, currentIndex, totalCount, selectedValue } = state;

  // ── 마침 ──────────────────────────────────────────────────────
  //
  // 점수를 보여주지 않는다. 검사에는 결과 화면이 있지만 연습에는 없다 —
  // 몇 개 맞았는지를 세는 순간 연습이 시험이 된다. 보여줄 것은 "했다"는
  // 사실뿐이다.
  if (phase === 'done') {
    return (
      <div className="font-pretendard mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-16">
        <span aria-hidden="true" className="text-6xl">
          🌿
        </span>
        <h2 className="text-2xl font-bold text-[#1F2A26]">오늘 연습 끝!</h2>
        <p className="text-center text-lg leading-relaxed text-[#5C6661]">
          함께 해주셔서 고맙습니다.
          <br />
          내일 또 만나요.
        </p>
        <button
          type="button"
          onClick={onExit}
          className="min-h-[56px] w-full rounded-full bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
        >
          마치기
        </button>
      </div>
    );
  }

  if (currentItem === null) {
    // 방어적 처리 — 정상 흐름에선 도달하지 않는다.
    return null;
  }

  const isAnswered = phase === 'answered';

  return (
    <div className="font-pretendard mx-auto w-full max-w-2xl px-4 py-6">
      <QuizProgressBar current={currentIndex + 1} total={totalCount} />

      {/* key로 문항 변경 시 컴포넌트 내부 상태(고른 타일 등)를 초기화 */}
      <PracticeItemBody
        key={currentItem.id}
        playable={currentItem}
        isSelectable={state.isSelectable}
        selectedValue={selectedValue}
        onAnswer={actions.answer}
        onSkip={actions.skip}
      />

      {isAnswered && (
        <div className="mt-6">
          {/* 정오답과 무관하게 항상 같은 문구 — 정보량이 0이라 판정이 새지 않는다. */}
          <p
            className="mb-4 text-center text-lg font-medium text-[#5C6661]"
            role="status"
            aria-live="polite"
          >
            잘하고 계세요
          </p>
          <button
            type="button"
            onClick={actions.next}
            className="min-h-[56px] w-full rounded-full bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
            aria-label={
              currentIndex + 1 >= totalCount ? '연습 마치기' : '다음 문제'
            }
          >
            {currentIndex + 1 >= totalCount ? '연습 마치기' : '다음 문제'}
          </button>
        </div>
      )}

      {!isAnswered && (
        <button
          type="button"
          onClick={actions.endSession}
          className="mt-8 min-h-[48px] w-full text-base text-[#8B928D] underline underline-offset-4"
          aria-label="오늘은 그만하기"
        >
          오늘은 그만하기
        </button>
      )}
    </div>
  );
}
