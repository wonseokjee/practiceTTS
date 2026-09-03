// Step1: 무드 체크 화면
//
// §9-1-A: 세이지 그린 헤더 + 크림 베이지 배경 (메인 톤)
// §9-1-B: 5단계 이모지 시각 명세 (선택 시 색상 토큰 적용)

import type { MoodLevel, MoodVisualToken } from '../domain/CaptureFlow.js';
import { MOOD_VISUAL_TOKENS } from '../domain/CaptureFlow.js';

interface MoodCheckStepProps {
  mood: MoodLevel | null;
  onSelectMood: (level: MoodLevel) => void;
  onNext: () => void;
  error: string | null;
}

/**
 * 5단계 이모지로 보호자의 오늘 마음 상태를 기록한다.
 * - 필수 단계 (mood 선택 전엔 "다음" 비활성)
 */
export function MoodCheckStep({
  mood,
  onSelectMood,
  onNext,
  error,
}: MoodCheckStepProps) {
  const hasSelection = mood !== null;

  return (
    <section
      className="font-pretendard rounded-xl bg-canvas p-6 sm:p-8"
      aria-labelledby="mood-step-heading"
    >
      <header className="mb-6 text-center">
        <h2
          id="mood-step-heading"
          className="text-2xl font-bold text-primary"
        >
          오늘 본인의 마음은 어떠셨나요?
        </h2>
        <p className="mt-2 text-sm text-muted-sage">
          1초 안에 가까운 표정을 골라주세요.
        </p>
      </header>

      <div
        className="grid grid-cols-5 gap-3 sm:gap-4"
        role="radiogroup"
        aria-label="오늘의 마음 5단계"
      >
        {MOOD_VISUAL_TOKENS.map((token) => (
          <MoodButton
            key={token.level}
            token={token}
            isSelected={mood === token.level}
            onSelect={() => onSelectMood(token.level)}
          />
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-accent bg-accent-soft p-3 text-sm text-accent-ink"
        >
          {error}
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!hasSelection}
          className="rounded-xl bg-primary px-8 py-3 text-base font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-disabled-surface disabled:text-disabled-ink"
          aria-label="다음 단계로 이동"
        >
          다음
        </button>
      </div>
    </section>
  );
}

interface MoodButtonProps {
  token: MoodVisualToken;
  isSelected: boolean;
  onSelect: () => void;
}

function MoodButton({ token, isSelected, onSelect }: MoodButtonProps) {
  // 선택 상태에 따라 inline style로 색상 토큰을 직접 적용 (Tailwind arbitrary value 대신
  // — selectedBg/selectedBorder가 동적이므로 안전)
  const buttonStyle: React.CSSProperties = isSelected
    ? {
        backgroundColor: token.selectedBg,
        borderColor: token.selectedBorder,
      }
    : {};

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={token.ariaLabel}
      onClick={onSelect}
      className={`flex aspect-square w-full min-h-[88px] flex-col items-center justify-center gap-1 rounded-xl border-2 transition-all duration-[180ms] ease-out ${
        isSelected
          ? 'shadow-sm'
          : 'border-line-soft bg-white hover:border-muted-faint'
      }`}
      style={buttonStyle}
    >
      <span className="text-3xl sm:text-4xl" aria-hidden="true">
        {token.emoji}
      </span>
      <span className="text-xs text-muted-sage sm:text-sm">{token.label}</span>
    </button>
  );
}
