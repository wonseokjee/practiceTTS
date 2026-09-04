// 빈칸 채우기 입력 (fill_blank 유형)
//
// 한글 IME 친화: inputMode="text", autoFocus, Enter로 제출.
// hintFirstChar가 있으면 첫 글자 힌트를 노출한다.
// 피드백 단계에서는 입력을 잠그고 정답/오답 색상 + 정답 표시.

import { useState } from 'react';
import { copulaSuffix } from '../../../../../shared/domain/korean.js';

interface FillBlankInputProps {
  isSelectable: boolean;
  showFeedback: boolean;
  /** 채점 결과 — 피드백 단계에서만 의미 */
  isCorrect: boolean | null;
  /** 정답 텍스트 — 피드백 단계 노출 */
  correctAnswer: string | null;
  /** 첫 글자 힌트 (없으면 null) */
  hintFirstChar: string | null;
  onSubmit: (text: string) => void;
}

/** 단답형 빈칸 입력 */
export function FillBlankInput({
  isSelectable,
  showFeedback,
  isCorrect,
  correctAnswer,
  hintFirstChar,
  onSubmit,
}: FillBlankInputProps) {
  const [text, setText] = useState<string>('');

  const handleSubmit = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
  };

  // 피드백 단계 입력 박스 색상.
  let fieldClass = 'border-line-strong bg-white text-ink-sage';
  if (showFeedback) {
    fieldClass =
      isCorrect === true
        ? 'border-primary bg-primary-light text-primary-dark'
        : 'border-accent bg-accent-soft text-accent-ink';
  }

  return (
    <div className="flex flex-col gap-4">
      {hintFirstChar !== null && hintFirstChar.length > 0 && (
        <p className="text-base text-muted-sage">
          힌트: 첫 글자는{' '}
          <span className="font-bold text-primary">{hintFirstChar}</span>
          {copulaSuffix(hintFirstChar)}
        </p>
      )}

      <div className="relative flex items-center">
        <input
          type="text"
          inputMode="text"
          autoFocus
          disabled={!isSelectable}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              handleSubmit();
            }
          }}
          aria-label="답 입력"
          placeholder="답을 입력하세요"
          className={`min-h-[64px] w-full rounded-md border-2 px-5 py-4 text-xl font-medium transition-colors duration-[180ms] ease-out outline-none focus:border-primary disabled:cursor-default ${fieldClass}`}
        />
        {showFeedback && (
          <span
            className="absolute right-4 text-2xl"
            aria-hidden="true"
          >
            {isCorrect === true ? '✓' : '✗'}
          </span>
        )}
      </div>

      {showFeedback && isCorrect === false && correctAnswer !== null && (
        <p className="text-base text-muted-sage">
          정답:{' '}
          <span className="font-bold text-primary">{correctAnswer}</span>
        </p>
      )}

      {!showFeedback && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isSelectable || text.trim().length === 0}
          className="min-h-[56px] rounded-md bg-primary px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-disabled-surface disabled:text-disabled-ink"
          aria-label="답 제출"
        >
          제출
        </button>
      )}
    </div>
  );
}
