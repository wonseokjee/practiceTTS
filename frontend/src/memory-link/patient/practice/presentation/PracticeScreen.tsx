// 연습 모드 화면
//
// **검사 화면(QuizScreen)과 다른 점: 채점하지 않고 가르친다.**
//
// QuizScreen은 답을 내면 정답 카드를 초록✓, 내가 고른 오답을 빨강✗로 칠한다.
// 성적을 알리는 화면이다. 연습은 같은 컴포넌트를 `answerOnly`로 켜서 **정답
// 카드만** 표시한다. ✗도 빨강도 없다.
//
// 흐름은 이렇다.
//
//   틀림  →  판정 없이 "다시 한번 해볼까요?"  (최대 3번)
//   맞힘  →  "맞아요, '사과'예요."  ("칫솔"이면 "칫솔이에요" — 받침을 본다)
//   3번 다 틀림  →  "이건 '사과'예요."
//
// 어느 쪽이든 **정답을 본 채로** 문항이 끝난다. 피드백 없는 드릴에서 어르신이
// 사과를 계속 배로 고르면 그 오답이 반복으로 강화된다. 연습이 재활이 아니라
// 오학습이 되는 것을 막는 것이 이 화면의 목적이다.
//
// **점수는 여전히 없다.** 시험이 되는 지점은 집계지 문항별 안내가 아니다.
// 진행 중에도, 종료 화면에도 숫자를 두지 않는다.

import { useEffect, useRef } from 'react';
import type { PracticePlayable } from '../domain/Practice.js';
import {
  usePracticeSession,
  type PracticeOutcome,
  type UsePracticeDeps,
} from '../application/usePracticeSession.js';
import { copulaSuffix } from '../../../../shared/domain/korean.js';
import { ItemProgressBar } from '../../../../shared/components/ItemProgressBar.js';
import { ImageChoiceQuizItem } from '../../quiz/presentation/components/ImageChoiceQuizItem.js';
import { SpellTileItem } from '../../quiz/presentation/components/SpellTileItem.js';
import { OddOneOutItem } from './components/OddOneOutItem.js';
import { WordChoiceItem } from './components/WordChoiceItem.js';

interface PracticeScreenProps {
  /** 세션을 마치거나 그만둘 때 호출 */
  onExit: () => void;
  /** 테스트용 의존성 주입 (선택) */
  deps?: UsePracticeDeps;
}

/**
 * 지금 화면에 띄울 문구.
 *
 * 재시도 안내는 어르신이 틀렸다는 사실을 **판정 없이** 전한다. "틀렸어요"라고
 * 하지 않고 한 번 더 권한다. 정답 안내는 맞혔든 아니든 같은 자리에 온다 —
 * 다른 것은 앞의 한마디뿐이다.
 */
function messageFor(
  phase: 'answering' | 'revealed' | 'done',
  attemptNo: number,
  outcome: PracticeOutcome | null,
  answerLabel: string | null,
): string | null {
  if (phase === 'revealed' && answerLabel !== null) {
    // 조사는 낱말의 받침을 보고 고른다. 그냥 이어붙이면 "칫솔예요"가 된다.
    const quoted = `'${answerLabel}'${copulaSuffix(answerLabel)}`;
    return outcome === 'correct' ? `맞아요, ${quoted}.` : `이건 ${quoted}.`;
  }
  if (phase === 'answering' && attemptNo === 2) return '다시 한번 해볼까요?';
  if (phase === 'answering' && attemptNo >= 3) return '한 번만 더 해볼까요?';
  return null;
}

/** 문항 종류별 렌더 — 어느 갈래도 오답을 표시하지 않는다. */
function PracticeItemBody({
  playable,
  isSelectable,
  isRevealed,
  selectedValue,
  onAnswer,
  onSkip,
}: {
  playable: PracticePlayable;
  isSelectable: boolean;
  isRevealed: boolean;
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
          showFeedback={isRevealed}
          // 정답 카드만 표시한다. 내가 고른 오답은 칠하지 않는다.
          answerOnly
          selectedChoiceId={selectedValue}
          onSelect={onAnswer}
        />
      );
    case 'wordChoice':
      // 연습 전용 컴포넌트라 선택 prop이 없다 — 처음부터 연습 규칙만 갖는다.
      return (
        <WordChoiceItem
          item={playable.item}
          isSelectable={isSelectable}
          showAnswer={isRevealed}
          selectedChoiceId={selectedValue}
          onSelect={onAnswer}
        />
      );
    case 'oddOneOut':
      return (
        <OddOneOutItem
          item={playable.item}
          isSelectable={isSelectable}
          showAnswer={isRevealed}
          selectedChoiceId={selectedValue}
          onSelect={onAnswer}
        />
      );
    case 'spell':
      // 철자 문항은 답이 곧 낱말이라 문구가 정답을 말해주면 충분하다.
      // 컴포넌트 자체 피드백(빨강·정답 노출)은 쓰지 않는다.
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
  const {
    phase,
    currentItem,
    currentIndex,
    totalCount,
    attemptNo,
    selectedValue,
    outcome,
    correctAnswerLabel,
  } = state;
  const messageRef = useRef<HTMLDivElement>(null);

  const message = messageFor(phase, attemptNo, outcome, correctAnswerLabel);

  // 문구와 "다음 문제"를 화면 안으로 끌어온다.
  //
  // 4지선다 그림 문항은 카드 2×2만으로 약 630px이라, 높이 720px 화면에서는
  // 아래에 붙는 문구와 버튼이 접힌 곳 밑으로 밀린다. 화면에는 카드만 남고
  // 앞으로 갈 방법이 하나도 안 보인다 — 어르신에게는 막다른 길로 읽힌다.
  //
  // block:'nearest'는 필요한 만큼만 스크롤하므로, 이미 보이는 태블릿·휴대폰
  // 크기에서는 아무 일도 하지 않는다.
  useEffect(() => {
    if (message === null) return;
    const el = messageRef.current;
    // jsdom에는 scrollIntoView가 없다.
    if (!el || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [message]);

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
        <h2 className="text-2xl font-bold text-ink-sage">오늘 연습 끝!</h2>
        <p className="text-center text-lg leading-relaxed text-muted-sage">
          함께 해주셔서 고맙습니다.
          <br />
          내일 또 만나요.
        </p>
        <button
          type="button"
          onClick={onExit}
          className="min-h-[56px] w-full rounded-full bg-primary px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark"
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

  const isRevealed = phase === 'revealed';
  const isLastItem = currentIndex + 1 >= totalCount;
  const advanceLabel = isLastItem ? '연습 마치기' : '다음 문제';

  return (
    <div className="font-pretendard mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-6">
        <ItemProgressBar current={currentIndex + 1} total={totalCount} />
      </div>

      {/*
        key에 시도 번호를 포함한다. 철자 문항은 조립한 글자를 컴포넌트가 자체
        상태로 들고 있어서, 재마운트해야 다시 처음부터 만들 수 있다.
      */}
      <PracticeItemBody
        key={`${currentItem.id}-${String(attemptNo)}`}
        playable={currentItem}
        isSelectable={state.isSelectable}
        isRevealed={isRevealed}
        selectedValue={selectedValue}
        onAnswer={actions.answer}
        onSkip={actions.skip}
      />

      {message !== null && (
        <div className="mt-6" ref={messageRef}>
          <p
            className="mb-4 text-center text-lg font-medium text-muted-sage"
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
          {isRevealed && (
            <button
              type="button"
              onClick={actions.next}
              className="min-h-[56px] w-full rounded-full bg-primary px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark"
              aria-label={advanceLabel}
            >
              {advanceLabel}
            </button>
          )}
        </div>
      )}

      {!isRevealed && (
        <button
          type="button"
          onClick={actions.endSession}
          className="mt-8 min-h-[48px] w-full text-base text-muted underline underline-offset-4"
          aria-label="오늘은 그만하기"
        >
          오늘은 그만하기
        </button>
      )}
    </div>
  );
}
