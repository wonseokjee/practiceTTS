// 예/아니오 버튼 (yes_no 유형)
//
// 각 버튼은 'yes' / 'no'를 제출한다 (서버가 다양한 표현을 정규화하므로 클라는 yes/no만 전송).
// 피드백 색상은 MultipleChoiceCard와 동일 규칙 + 아이콘 동반.

import { YES_NO_ANSWERS } from '../../domain/Quiz.js';
import { useTranslation } from 'react-i18next';
import type { YesNoAnswer } from '../../domain/Quiz.js';

interface YesNoButtonsProps {
  isSelectable: boolean;
  /** 사용자가 고른 값 ('yes'|'no') — 피드백 단계 */
  selectedAnswer: string | null;
  showFeedback: boolean;
  /** 정답 값 ('yes'|'no') — 피드백 단계에서만 의미 */
  correctAnswer: string | null;
  onSelect: (answer: YesNoAnswer) => void;
}

interface OptionSpec {
  value: YesNoAnswer;
  labelKey: 'yesNo.yes' | 'yesNo.no';
}

const OPTIONS: OptionSpec[] = [
  { value: YES_NO_ANSWERS.YES, labelKey: 'yesNo.yes' },
  { value: YES_NO_ANSWERS.NO, labelKey: 'yesNo.no' },
];

/** 예/아니오 2지선다 */
export function YesNoButtons({
  isSelectable,
  selectedAnswer,
  showFeedback,
  correctAnswer,
  onSelect,
}: YesNoButtonsProps) {
  const { t } = useTranslation('quiz');
  return (
    <div
      className="grid grid-cols-2 gap-4"
      role="group"
      aria-label={t('yesNo.groupAria')}
    >
      {OPTIONS.map((opt) => {
        const isSelected = selectedAnswer === opt.value;
        const isCorrectAnswer = correctAnswer === opt.value;

        let stateClass =
          'border-line-soft bg-white text-ink-sage hover:border-muted-faint';
        let icon: string | null = null;

        if (showFeedback) {
          if (isCorrectAnswer) {
            stateClass = 'border-primary bg-primary-light text-primary-dark';
            icon = '✓';
          } else if (isSelected) {
            stateClass = 'border-accent bg-accent-soft text-accent-ink';
            icon = '✗';
          } else {
            stateClass = 'border-line-soft bg-white text-muted-disabled';
          }
        } else if (isSelected) {
          stateClass = 'border-primary bg-primary-light text-primary-dark';
        }

        return (
          <button
            key={opt.value}
            type="button"
            disabled={!isSelectable}
            onClick={() => onSelect(opt.value)}
            aria-label={t(opt.labelKey)}
            aria-pressed={isSelected}
            className={`flex min-h-[80px] items-center justify-center gap-2 rounded-md border-2 px-5 py-4 text-2xl font-bold transition-colors duration-[180ms] ease-out disabled:cursor-default ${stateClass}`}
          >
            <span>{t(opt.labelKey)}</span>
            {icon !== null && (
              <span aria-hidden="true">{icon}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
