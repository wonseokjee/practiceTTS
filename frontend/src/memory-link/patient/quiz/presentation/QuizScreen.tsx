// 퀴즈 풀이 컨테이너 (혼합 세트: 데일리 + QAB 질문형)
//
// useMixedQuizSession FSM을 사용한다. 비즈니스 로직은 훅에 위임하고
// 진행바 + 사진 힌트 + 항목 렌더(데일리/QAB 분기) + 피드백/다음만 담당한다.
//
// - daily 항목: QuestionBody(객관식/타일/말하기)를 렌더하고 백엔드로 채점한다.
//   QuestionBody가 자신이 고른 값을 기억해 오답 강조에 쓰므로, 항목이 바뀌면
//   key(item.id)로 리마운트해 선택 상태를 초기화한다.
// - qab_word 항목: WordCompQuizItem(듣고 그림 고르기)을 렌더하고 로컬 채점한다.

import { useEffect, useRef, useState } from 'react';
import { useMixedQuizSession } from '../application/useMixedQuizSession.js';
import type { UseMixedQuizDeps } from '../application/useMixedQuizSession.js';
import type { AttemptResult, QuizQuestionPublic, YesNoAnswer } from '../domain/Quiz.js';
import { CaregiverWishCard } from './CaregiverWishCard.js';
import { QuizPhotoHint } from './QuizPhotoHint.js';
import { QuizProgressBar } from './QuizProgressBar.js';
import { QuizResultScreen } from './QuizResultScreen.js';
import { FillBlankInput } from './components/FillBlankInput.js';
import { MultipleChoiceCard } from './components/MultipleChoiceCard.js';
import { SpeechInput } from './components/SpeechInput.js';
import { TileArrangeInput } from './components/TileArrangeInput.js';
import { ImageChoiceQuizItem } from './components/ImageChoiceQuizItem.js';
import { SpellTileItem } from './components/SpellTileItem.js';
import { PictureNamingItem } from './components/PictureNamingItem.js';
import { SpeechCaptureItem } from './components/SpeechCaptureItem.js';
import { DdkItem } from './components/DdkItem.js';
import { YesNoButtons } from './components/YesNoButtons.js';

interface QuizScreenProps {
  quizSetId: string;
  /** 결과 화면 또는 취소 시 목록으로 복귀 */
  onExit: () => void;
  /** 테스트용 의존성 주입 (선택) */
  deps?: UseMixedQuizDeps;
}

/** 퀴즈 풀이 화면 컨테이너 */
export function QuizScreen({ quizSetId, onExit, deps }: QuizScreenProps) {
  const [state, actions] = useMixedQuizSession(quizSetId, deps);
  // Phase 6: 보호자 한마디 카드를 퀴즈 앞에 한 번 노출 (있을 때만).
  const [wishDismissed, setWishDismissed] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const {
    phase,
    currentIndex,
    total,
    currentItem,
    detail,
    isSelectable,
    lastResult,
    selectedChoiceId,
    sessionScore,
    error,
    isSessionExpired,
    attempt,
  } = state;
  // 답한 뒤 "다음 문제"를 화면 안으로 끌어온다(연습 화면 ISSUE-001과 같은 수정).
  //
  // **실측(400×720, 2026-08-24).** 그림 격자는 2열이고 카드 178px + 간격 12px,
  // 격자 top 180px이다. 피드백 블록(문구 + 버튼)은 124px.
  //
  //   레벨 1    보기 2개    1행   버튼 바닥 482   들어옴
  //   레벨 2~4  보기 3~4개  2행   버튼 바닥 672   들어옴
  //   레벨 5    보기 5개    3행   버튼 바닥 862   **접힘**
  //
  // TODO-112는 "4지선다에서 y=888"로 적혀 있었지만 그건 적응 레벨이 붙기 전
  // 기준이다. 지금 4지선다는 672로 들어오고, 레벨 5의 5지선다만 밀려난다.
  // 화면에는 카드만 남고 앞으로 갈 방법이 안 보인다 — 어르신에게는 막다른 길이다.
  //
  // block:'nearest'는 필요한 만큼만 스크롤하므로 이미 보이는 레벨 1~4와 큰
  // 화면에서는 아무 일도 하지 않는다. **훅은 조기 반환보다 위에 있어야 한다** —
  // 로딩·에러·한마디 카드가 아래에서 먼저 반환하므로 여기가 유일하게 맞는 자리다.
  useEffect(() => {
    if (phase !== 'feedback') return;
    const el = feedbackRef.current;
    // jsdom에는 scrollIntoView가 없다.
    if (!el || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [phase, currentIndex]);


  // ── 로딩 ──────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div
        className="font-pretendard flex min-h-[60vh] items-center justify-center"
        role="status"
      >
        <p className="text-xl text-[#5C6661]">퀴즈를 준비하고 있어요...</p>
      </div>
    );
  }

  // ── 에러 ──────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="font-pretendard mx-auto mt-10 w-full max-w-md px-4">
        <div
          className="rounded-3xl border border-[#E07B54] bg-[#FBE9E2] p-6 text-center"
          role="alert"
        >
          <p className="mb-5 text-lg text-[#7A2E15]">
            {error ?? '문제가 생겼어요.'}
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void actions.retry()}
              className="min-h-[56px] rounded-full bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
            >
              {isSessionExpired ? '다시 시작' : '다시 시도'}
            </button>
            <button
              type="button"
              onClick={onExit}
              className="min-h-[48px] rounded-full bg-white px-6 py-3 text-base font-medium text-[#5C6661] transition-colors duration-[180ms] ease-out hover:bg-[#EBEAE6]"
            >
              목록으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 결과 ──────────────────────────────────────────────────────
  if (phase === 'result') {
    return (
      <QuizResultScreen
        sessionScore={sessionScore ?? 0}
        bestScore={null}
        isNewBest={false}
        showScore={false}
        onRetry={() => void actions.retry()}
        onBackToList={onExit}
      />
    );
  }

  // ── 보호자 한마디 카드 (Phase 6) — 풀이 전 1회 노출 ──────────────
  const wishMessage = detail?.memoryEntry.caregiverWishMessage ?? null;
  if (wishMessage !== null && !wishDismissed) {
    return (
      // 이 화면에는 이 카드 하나뿐이라(early return) 위에서부터 쌓으면 모바일에서
      // 아래가 통째로 빈다. 세로 가운데에 둔다 — 퀴즈로 넘어가기 전 한 번 읽는
      // 카드라 화면 한가운데 놓이는 편이 그 성격에도 맞는다.
      //
      // 카드가 뷰포트보다 길어지면 `min-h-dvh` 컨테이너가 같이 늘어나므로
      // 가운데 정렬이 위를 잘라먹지 않는다.
      <div className="font-pretendard mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-6">
        <CaregiverWishCard
          quizSetId={quizSetId}
          wishMessage={wishMessage}
          onProceed={() => setWishDismissed(true)}
        />
      </div>
    );
  }

  // ── 풀이/피드백 ───────────────────────────────────────────────
  if (currentItem === null) {
    // 방어적 처리 — 정상 흐름에선 도달하지 않음.
    return null;
  }

  const showFeedback = phase === 'feedback';
  const isSubmitting = phase === 'submitting';
  const canAnswer = isSelectable && !isSubmitting;
  const photoUrl = detail?.memoryEntry.photoUrl ?? null;
  const isLastQuestion = currentIndex + 1 >= total;

  // 데일리 항목의 피드백을 QuestionBody가 기대하는 AttemptResult 형태로 합성.
  const dailyResult: AttemptResult | null =
    showFeedback && lastResult !== null && currentItem.kind === 'daily'
      ? {
          questionId: currentItem.id,
          isCorrect: lastResult.isCorrect,
          correctAnswer: lastResult.correctLabel ?? '',
        }
      : null;

  return (
    <div className="font-pretendard mx-auto w-full max-w-2xl px-4 py-6">
      <QuizProgressBar current={currentIndex + 1} total={total} />

      {/* 사진 힌트는 데일리(기억 회상) 항목에서만 노출 */}
      {currentItem.kind === 'daily' && photoUrl !== null && (
        <QuizPhotoHint photoUrl={photoUrl} />
      )}

      {/* 데일리 항목은 prompt를 제목으로 노출 (QAB는 컴포넌트 내부 안내 사용) */}
      {currentItem.kind === 'daily' && (
        <h2
          className="mb-6 text-2xl font-bold leading-snug text-[#1F2A26]"
          aria-live="polite"
        >
          {currentItem.question.prompt}
        </h2>
      )}

      {/* key=item.id로 항목 변경 시 내부 선택 상태 자동 초기화 */}
      {currentItem.kind === 'daily' ? (
        <QuestionBody
          key={currentItem.id}
          question={currentItem.question}
          canAnswer={canAnswer}
          showFeedback={showFeedback}
          result={dailyResult}
          onSubmit={(answer) => void actions.submitDaily(answer)}
        />
      ) : currentItem.kind === 'naming' ? (
        <PictureNamingItem
          key={`${currentItem.id}:${attempt}`}
          item={currentItem.item}
          isSelectable={canAnswer}
          showFeedback={showFeedback}
          isCorrect={showFeedback ? (lastResult?.isCorrect ?? null) : null}
          onSubmit={(transcript, azure) =>
            actions.submitNaming(transcript, azure)
          }
          onSkip={actions.skipCurrent}
          onOverride={actions.overrideSpeechVerdict}
        />
      ) : currentItem.kind === 'repeat' ? (
        <SpeechCaptureItem
          key={`${currentItem.id}:${attempt}`}
          text={currentItem.item.text}
          instruction={currentItem.item.instruction}
          showModel
          isSelectable={canAnswer}
          showFeedback={showFeedback}
          isCorrect={showFeedback ? (lastResult?.isCorrect ?? null) : null}
          onSubmit={(transcript, azure) => actions.submitSpeech(transcript, azure)}
          onSkip={actions.skipCurrent}
          onOverride={actions.overrideSpeechVerdict}
        />
      ) : currentItem.kind === 'reading' ? (
        <SpeechCaptureItem
          key={`${currentItem.id}:${attempt}`}
          text={currentItem.item.text}
          instruction={currentItem.item.instruction}
          showModel={false}
          isSelectable={canAnswer}
          showFeedback={showFeedback}
          isCorrect={showFeedback ? (lastResult?.isCorrect ?? null) : null}
          onSubmit={(transcript, azure) => actions.submitSpeech(transcript, azure)}
          onSkip={actions.skipCurrent}
          onOverride={actions.overrideSpeechVerdict}
        />
      ) : currentItem.kind === 'ddk' ? (
        <DdkItem
          key={currentItem.id}
          item={currentItem.item}
          isSelectable={canAnswer}
          showFeedback={showFeedback}
          isCorrect={showFeedback ? (lastResult?.isCorrect ?? null) : null}
          onSubmit={(count) => actions.submitDdk(count)}
          onSkip={actions.skipCurrent}
        />
      ) : currentItem.kind === 'spell' ? (
        <SpellTileItem
          key={currentItem.id}
          item={currentItem.item}
          isSelectable={canAnswer}
          showFeedback={showFeedback}
          isCorrect={showFeedback ? (lastResult?.isCorrect ?? null) : null}
          onSubmit={(assembled) => actions.submitSpell(assembled)}
          onSkip={actions.skipCurrent}
        />
      ) : (
        <ImageChoiceQuizItem
          key={currentItem.id}
          item={currentItem.item}
          isSelectable={canAnswer}
          showFeedback={showFeedback}
          selectedChoiceId={selectedChoiceId}
          onSelect={(choiceId) => actions.submitQabChoice(choiceId)}
        />
      )}

      {/* 채점 중 표시 */}
      {isSubmitting && (
        <p className="mt-6 text-center text-base text-[#5C6661]" role="status">
          채점 중...
        </p>
      )}

      {/* 피드백 + 다음 버튼 */}
      {showFeedback && lastResult !== null && (
        <div className="mt-6" ref={feedbackRef}>
          <p
            className={`mb-4 text-center text-lg font-bold ${
              lastResult.isCorrect ? 'text-[#1F5240]' : 'text-[#7A2E15]'
            }`}
            role="status"
            aria-live="polite"
          >
            {/* 발화 항목은 5단계 격려 문구(어르신용, 숫자 미노출), 그 외는 정오답 */}
            {lastResult.encouragement ??
              (lastResult.isCorrect ? '정답이에요!' : '아쉬워요')}
          </p>
          {/* 발화/이름대기 오답이면 같은 문항을 다시 말할 수 있게 한다
              (격려 문구 "다시 말해볼까요?"를 실제로 행동으로 이어준다). */}
          {(currentItem.kind === 'naming' ||
            currentItem.kind === 'repeat' ||
            currentItem.kind === 'reading') &&
            lastResult.isCorrect === false && (
              <button
                type="button"
                onClick={actions.answerAgain}
                className="mb-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full border-2 border-[#2D6A56] bg-white px-6 py-3 text-lg font-medium text-[#2D6A56] transition-colors duration-[180ms] ease-out hover:bg-[#EBF4F0]"
                aria-label="다시 말하기"
              >
                <span aria-hidden="true" className="text-2xl">🎤</span>
                다시 말하기
              </button>
            )}
          <button
            type="button"
            onClick={actions.next}
            className="min-h-[56px] w-full rounded-full bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
            aria-label={isLastQuestion ? '결과 보기' : '다음 문제'}
          >
            {isLastQuestion ? '결과 보기' : '다음 문제'}
          </button>
        </div>
      )}

      {/* 취소 */}
      {!showFeedback && (
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={onExit}
            className="text-sm text-[#6B6560] transition-colors duration-[180ms] hover:text-[#3F4A44]"
            aria-label="퀴즈 그만두기"
          >
            {/* 세션을 끝내면 홈으로 돌아간다(DR1b). 예전엔 목록으로 갔다. */}
            그만두고 처음으로
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 문제 본문 (데일리 유형별 분기 + 선택값 추적) ─────────────────────────

interface QuestionBodyProps {
  question: QuizQuestionPublic;
  canAnswer: boolean;
  showFeedback: boolean;
  /** 채점 결과 (피드백 단계에서만 non-null) */
  result: AttemptResult | null;
  onSubmit: (answer: string) => void;
}

/**
 * 데일리 유형별 답안 컴포넌트를 분기 렌더한다.
 * 자신이 고른 값(selectedAnswer)을 기억해 오답 보기 강조에 사용.
 * 문제가 바뀌면 부모가 key로 리마운트하므로 selectedAnswer는 자연히 초기화된다.
 */
function QuestionBody({
  question,
  canAnswer,
  showFeedback,
  result,
  onSubmit,
}: QuestionBodyProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const correctAnswer = showFeedback ? (result?.correctAnswer ?? null) : null;

  const handleSubmit = (answer: string): void => {
    setSelectedAnswer(answer);
    onSubmit(answer);
  };

  if (question.type === 'multiple_choice') {
    return (
      <div className="flex flex-col gap-3">
        {(question.choices ?? []).map((choice) => (
          <MultipleChoiceCard
            key={choice}
            choice={choice}
            isSelectable={canAnswer}
            isSelected={selectedAnswer === choice}
            showFeedback={showFeedback}
            isCorrectAnswer={correctAnswer === choice}
            onSelect={handleSubmit}
          />
        ))}
      </div>
    );
  }

  if (question.type === 'yes_no') {
    return (
      <YesNoButtons
        isSelectable={canAnswer}
        selectedAnswer={selectedAnswer}
        showFeedback={showFeedback}
        correctAnswer={correctAnswer}
        onSelect={(answer: YesNoAnswer) => handleSubmit(answer)}
      />
    );
  }

  if (question.type === 'tile_arrange') {
    return (
      <TileArrangeInput
        tiles={question.choices ?? []}
        isSelectable={canAnswer}
        showFeedback={showFeedback}
        isCorrect={showFeedback ? (result?.isCorrect ?? null) : null}
        correctAnswer={correctAnswer}
        hintFirstChar={question.hintFirstChar}
        onSubmit={handleSubmit}
      />
    );
  }

  if (question.type === 'speech') {
    return (
      <SpeechInput
        targetWord={question.targetWord}
        isSelectable={canAnswer}
        showFeedback={showFeedback}
        isCorrect={showFeedback ? (result?.isCorrect ?? null) : null}
        correctAnswer={correctAnswer}
        onSubmit={handleSubmit}
      />
    );
  }

  // fill_blank
  return (
    <FillBlankInput
      isSelectable={canAnswer}
      showFeedback={showFeedback}
      isCorrect={showFeedback ? (result?.isCorrect ?? null) : null}
      correctAnswer={correctAnswer}
      hintFirstChar={question.hintFirstChar}
      onSubmit={handleSubmit}
    />
  );
}
