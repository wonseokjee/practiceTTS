// 글자 타일 조합 입력
//
// 키보드 타이핑 없이 음절 타일을 탭해서 단어를 조합한다 (고령 환자 접근성).
// tiles에는 정답 음절 + 오답 음절이 섞여 있다. 같은 음절이 여러 개일 수 있으므로
// 타일은 "인덱스" 단위로 사용 여부를 추적한다.
//
// 피드백 단계 색상은 FillBlankInput과 동일 규칙 + 아이콘 동반.
//
// QAB `spell` 검사(SpellTileItem)가 이 조합 메커니즘을 그대로 재사용한다.
// 예전엔 기억 기반 데일리 문항(`tile_arrange` 유형)도 같은 컴포넌트를 썼는데,
// 그 유형이 은퇴하면서(#48) 넘어가기(onSkip)를 이 컴포넌트에 넘기던 유일한
// 호출부가 사라졌다 — 그래서 onSkip을 없앴다. SpellTileItem은 처음부터 자기
// 넘어가기 버튼을 이 컴포넌트 바깥에 따로 둔다.

import { useState } from 'react';
import { copulaSuffix } from '../../../../../shared/domain/korean.js';

interface TileArrangeInputProps {
  /** 섞인 음절 타일 (서버 choices) */
  tiles: string[];
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

/** 선택된 타일 1개 (원본 타일 인덱스를 함께 보관해 중복 음절을 구분) */
interface PickedTile {
  char: string;
  tileIndex: number;
}

/** 글자 타일 조합 입력 */
export function TileArrangeInput({
  tiles,
  isSelectable,
  showFeedback,
  isCorrect,
  correctAnswer,
  hintFirstChar,
  onSubmit,
}: TileArrangeInputProps) {
  const [picked, setPicked] = useState<PickedTile[]>([]);

  const usedIndices = new Set(picked.map((p) => p.tileIndex));
  const assembled = picked.map((p) => p.char).join('');

  const handlePick = (char: string, tileIndex: number): void => {
    if (!isSelectable || usedIndices.has(tileIndex)) return;
    setPicked((prev) => [...prev, { char, tileIndex }]);
  };

  const handleRemoveLast = (): void => {
    if (!isSelectable) return;
    setPicked((prev) => prev.slice(0, -1));
  };

  const handleClear = (): void => {
    if (!isSelectable) return;
    setPicked([]);
  };

  const handleSubmit = (): void => {
    if (assembled.length === 0) return;
    onSubmit(assembled);
  };

  // 조합 결과 박스 색상 (피드백 단계).
  let answerBoxClass = 'border-line-strong bg-white text-ink-sage';
  if (showFeedback) {
    answerBoxClass =
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

      {/* 조합 결과 표시 */}
      <div
        className={`flex min-h-[64px] items-center justify-between gap-3 rounded-md border-2 px-5 py-4 transition-colors duration-[180ms] ease-out ${answerBoxClass}`}
        aria-live="polite"
        aria-label={assembled.length > 0 ? `조합한 답: ${assembled}` : '아직 고른 글자가 없어요'}
      >
        <span className="text-2xl font-bold tracking-wide">
          {assembled.length > 0 ? (
            assembled
          ) : (
            <span className="text-muted-sage">글자를 눌러 단어를 만들어요</span>
          )}
        </span>
        {showFeedback && (
          <span className="text-2xl" aria-hidden="true">
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

      {/* 타일 목록 (피드백 단계에선 숨김) */}
      {!showFeedback && (
        <>
          <div
            className="flex flex-wrap gap-3"
            role="group"
            aria-label="글자 타일"
          >
            {tiles.map((tile, index) => {
              const used = usedIndices.has(index);
              return (
                <button
                  // 타일은 중복 음절이 있을 수 있어 index를 key에 포함한다.
                  key={`${tile}-${index}`}
                  type="button"
                  disabled={!isSelectable || used}
                  onClick={() => handlePick(tile, index)}
                  aria-label={`${tile} 글자 넣기`}
                  className={`min-h-[64px] min-w-[64px] rounded-md border-2 px-5 py-4 text-2xl font-bold transition-colors duration-[180ms] ease-out ${
                    used
                      ? 'border-line-soft bg-surface-dim text-disabled-surface'
                      : 'border-line-soft bg-white text-ink-sage hover:border-muted-faint'
                  }`}
                >
                  {tile}
                </button>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleRemoveLast}
              disabled={!isSelectable || picked.length === 0}
              className="min-h-[48px] flex-1 rounded-md bg-white px-4 py-3 text-base font-medium text-muted-sage ring-1 ring-inset ring-line-strong transition-colors duration-[180ms] ease-out hover:bg-canvas-hover disabled:cursor-not-allowed disabled:text-disabled-surface"
              aria-label="한 글자 지우기"
            >
              ← 한 글자 지우기
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={!isSelectable || picked.length === 0}
              className="min-h-[48px] rounded-md bg-white px-4 py-3 text-base font-medium text-muted-sage ring-1 ring-inset ring-line-strong transition-colors duration-[180ms] ease-out hover:bg-canvas-hover disabled:cursor-not-allowed disabled:text-disabled-surface"
              aria-label="모두 지우기"
            >
              모두 지우기
            </button>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isSelectable || assembled.length === 0}
            className="min-h-[56px] rounded-md bg-primary px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-disabled-surface disabled:text-disabled-ink"
            aria-label="답 제출"
          >
            제출
          </button>
        </>
      )}
    </div>
  );
}
