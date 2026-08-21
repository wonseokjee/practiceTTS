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
  let fieldClass = 'border-[#D4D8D4] bg-white text-[#1F2A26]';
  if (showFeedback) {
    fieldClass =
      isCorrect === true
        ? 'border-[#2D6A56] bg-[#EBF4F0] text-[#1F5240]'
        : 'border-[#E07B54] bg-[#FBE9E2] text-[#7A2E15]';
  }

  return (
    <div className="flex flex-col gap-4">
      {hintFirstChar !== null && hintFirstChar.length > 0 && (
        <p className="text-base text-[#5C6661]">
          힌트: 첫 글자는{' '}
          <span className="font-bold text-[#2D6A56]">{hintFirstChar}</span>
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
          className={`min-h-[64px] w-full rounded-md border-2 px-5 py-4 text-xl font-medium transition-colors duration-[180ms] ease-out outline-none focus:border-[#2D6A56] disabled:cursor-default ${fieldClass}`}
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
        <p className="text-base text-[#5C6661]">
          정답:{' '}
          <span className="font-bold text-[#2D6A56]">{correctAnswer}</span>
        </p>
      )}

      {!showFeedback && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isSelectable || text.trim().length === 0}
          className="min-h-[56px] rounded-md bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240] disabled:cursor-not-allowed disabled:bg-[#C5C8C5] disabled:text-[#7A7E7A]"
          aria-label="답 제출"
        >
          제출
        </button>
      )}
    </div>
  );
}
