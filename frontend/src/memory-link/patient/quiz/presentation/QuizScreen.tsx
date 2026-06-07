// 퀴즈 풀이 컨테이너
//
// useQuizSession FSM을 사용한다. 비즈니스 로직은 훅에 위임하고
// 진행바 + 사진 힌트 + 문제 렌더 + 유형별 컴포넌트 분기 + 피드백/다음만 담당.
//
// 즉시 채점 방식이라 서버 응답에는 정답(correctAnswer)만 포함되고
// "사용자가 무엇을 골랐는지"는 없으므로, QuestionBody가 자신이 고른 값을
// 로컬 state로 기억해 오답 보기 강조에 사용한다.
// 문제가 바뀌면 QuestionBody를 key(questionId)로 리마운트해 선택 상태를 초기화한다.

import { useState } from 'react';
import { useQuizSession } from '../application/useQuizSession.js';
import type { UseQuizSessionDeps } from '../application/useQuizSession.js';
import type { AttemptResult, QuizQuestionPublic, YesNoAnswer } from '../domain/Quiz.js';
import { QuizPhotoHint } from './QuizPhotoHint.js';
import { QuizProgressBar } from './QuizProgressBar.js';
import { QuizResultScreen } from './QuizResultScreen.js';
import { FillBlankInput } from './components/FillBlankInput.js';
import { MultipleChoiceCard } from './components/MultipleChoiceCard.js';
import { YesNoButtons } from './components/YesNoButtons.js';

interface QuizScreenProps {
  quizSetId: string;
  /** 결과 화면 또는 취소 시 목록으로 복귀 */
  onExit: () => void;
  /** 테스트용 의존성 주입 (선택) */
  deps?: UseQuizSessionDeps;
}

/** 퀴즈 풀이 화면 컨테이너 */
export function QuizScreen({ quizSetId, onExit, deps }: QuizScreenProps) {
  const [state, actions] = useQuizSession(quizSetId, deps);
  const {
    phase,
    currentIndex,
    total,
    currentQuestion,
    detail,
    isSelectable,
    lastResult,
    sessionScore,
    bestScore,
    isNewBest,
    error,
    isSessionExpired,
  } = state;

  // ── 로딩 ──────────────────────────────────────────────────────
  if (phase === 'loading_questions' || phase === 'idle') {
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
          className="rounded-lg border border-[#E07B54] bg-[#FBE9E2] p-6 text-center"
          role="alert"
        >
          <p className="mb-5 text-lg text-[#7A2E15]">
            {error ?? '문제가 생겼어요.'}
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void actions.retry()}
              className="min-h-[56px] rounded-md bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
            >
              {isSessionExpired ? '다시 시작' : '다시 시도'}
            </button>
            <button
              type="button"
              onClick={onExit}
              className="min-h-[48px] rounded-md bg-white px-6 py-3 text-base font-medium text-[#5C6661] transition-colors duration-[180ms] ease-out hover:bg-[#EBEAE6]"
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
        bestScore={bestScore}
        isNewBest={isNewBest}
        onRetry={() => void actions.retry()}
        onBackToList={onExit}
      />
    );
  }

  // ── 풀이/피드백 ───────────────────────────────────────────────
  if (currentQuestion === null) {
    // 방어적 처리 — 정상 흐름에선 도달하지 않음.
    return null;
  }

  const showFeedback = phase === 'feedback';
  const isSubmitting = phase === 'submitting' || phase === 'submitting_final';
  const canAnswer = isSelectable && !isSubmitting;
  const photoUrl = detail?.memoryEntry.photoUrl ?? null;
  const isLastQuestion = currentIndex + 1 >= total;

  return (
    <div className="font-pretendard mx-auto w-full max-w-2xl px-4 py-6">
      <QuizProgressBar current={currentIndex + 1} total={total} />

      {photoUrl !== null && <QuizPhotoHint photoUrl={photoUrl} />}

      <h2 className="mb-6 text-2xl font-bold leading-snug text-[#1F2A26]">
        {currentQuestion.prompt}
      </h2>

      {/* key=questionId로 문제 변경 시 선택 상태 자동 초기화 */}
      <QuestionBody
        key={currentQuestion.id}
        question={currentQuestion}
        canAnswer={canAnswer}
        showFeedback={showFeedback}
        result={showFeedback ? lastResult : null}
        onSubmit={(answer) => void actions.selectAndSubmit(answer)}
      />

      {/* 채점 중 표시 */}
      {isSubmitting && (
        <p className="mt-6 text-center text-base text-[#5C6661]" role="status">
          채점 중...
        </p>
      )}

      {/* 피드백 + 다음 버튼 */}
      {showFeedback && lastResult !== null && (
        <div className="mt-6">
          <p
            className={`mb-4 text-center text-lg font-bold ${
              lastResult.isCorrect ? 'text-[#1F5240]' : 'text-[#7A2E15]'
            }`}
            role="status"
            aria-live="polite"
          >
            {lastResult.isCorrect ? '정답이에요!' : '아쉬워요'}
          </p>
          <button
            type="button"
            onClick={actions.next}
            className="min-h-[56px] w-full rounded-md bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
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
            className="text-sm text-[#A8AFA9] transition-colors duration-[180ms] hover:text-[#5C6661]"
            aria-label="퀴즈 그만두기"
          >
            그만두고 목록으로
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 문제 본문 (유형별 분기 + 선택값 추적) ─────────────────────────

interface QuestionBodyProps {
  question: QuizQuestionPublic;
  canAnswer: boolean;
  showFeedback: boolean;
  /** 채점 결과 (피드백 단계에서만 non-null) */
  result: AttemptResult | null;
  onSubmit: (answer: string) => void;
}

/**
 * 유형별 답안 컴포넌트를 분기 렌더한다.
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
