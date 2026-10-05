// Step2: 나의 하루 화면 (보호자 사적 영역)
//
// §9-1-A: 메인 톤과 다른 면으로 시각 차별화 — LLM 미전달 영역
// 자물쇠 아이콘 + "보호자 본인만 볼 수 있어요" 캡션
// 건너뛰기 허용
//
// 2026-10-05 디자인 리뷰: 라벤더 일회성 hex를 「보호자 사적 영역」 토큰
// (accent-faint 면 + accent-ink 제목 + caregiver-muted 보조)으로 옮겼다. 선배 보호자
// 도우미와 같은 "보호자 본인 공간" 색이다. 🔒 이모지는 선 아이콘으로 바꿨다.
// 위기 연결처 줄(CrisisContactBar)은 페이지 맨 끝에 놓여야 해서 CaptureScreen이 붙인다.

import { useTranslation } from 'react-i18next';
import type { DiaryQuestion } from '../domain/CaptureFlow.js';
import { MAX_CAREGIVER_ANSWER_LENGTH } from '../domain/CaptureFlow.js';
import { LockIcon } from '../../shared/components/LineIcons.js';

interface MyDayStepProps {
  question: DiaryQuestion | null;
  answerText: string;
  onChangeAnswerText: (text: string) => void;
  onSkip: () => void;
  onNext: () => void;
  onPrev: () => void;
}

/**
 * 보호자 자기 질문 1개에 자유롭게 답변. 선택 단계로 건너뛰기 가능.
 * - 시각 톤: 메인 톤(세이지+크림)이 아닌 보호자 사적 영역(옅은 테라코타)으로 사적 공간 강조
 */
export function MyDayStep({
  question,
  answerText,
  onChangeAnswerText,
  onSkip,
  onNext,
  onPrev,
}: MyDayStepProps) {
  const { t } = useTranslation('caregiver');
  const charCount = answerText.length;

  return (
    <section
      className="font-pretendard rounded-xl bg-accent-faint p-6 sm:p-8"
      aria-labelledby="myday-step-heading"
    >
      <header className="mb-6">
        <div className="flex items-center gap-2 text-accent-ink">
          <LockIcon size={20} />
          <h2
            id="myday-step-heading"
            className="text-2xl font-bold text-accent-ink"
          >
            {t('myDayStep.title')}
          </h2>
        </div>
        <p className="mt-2 text-sm text-caregiver-muted">
          {t('myDayStep.privacyCaption')}
        </p>
      </header>

      <div className="rounded-xl border border-caregiver-line bg-white p-5">
        <p className="text-base font-medium text-ink-sage">
          {question ? question.text : t('myDayStep.loadingQuestion')}
        </p>

        <label className="mt-4 block">
          <span className="sr-only">{t('myDayStep.answerInputSrLabel')}</span>
          <textarea
            value={answerText}
            onChange={(e) => onChangeAnswerText(e.target.value)}
            disabled={!question}
            placeholder={t('myDayStep.answerPlaceholder')}
            maxLength={MAX_CAREGIVER_ANSWER_LENGTH}
            rows={5}
            className="w-full resize-none rounded-xl border border-caregiver-line bg-white p-3 text-sm leading-relaxed text-ink-sage focus:border-accent-strong focus:outline-none focus:ring-1 focus:ring-accent-strong disabled:bg-surface-dim"
            aria-label={t('myDayStep.answerAria')}
          />
        </label>

        <div
          className="mt-2 text-right text-xs text-caregiver-muted"
          aria-live="polite"
        >
          <span className="font-medium tabular-nums">{charCount}</span>
          {' / '}
          <span className="tabular-nums">{MAX_CAREGIVER_ANSWER_LENGTH}</span>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-xl px-5 py-3 text-sm font-medium text-caregiver-muted transition-colors duration-[180ms] ease-out hover:bg-accent-soft"
          aria-label={t('captureFlow.prevAria')}
        >
          {t('captureFlow.prev')}
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-xl border border-caregiver-line bg-white px-5 py-3 text-sm font-medium text-caregiver-muted transition-colors duration-[180ms] ease-out hover:bg-accent-soft"
            aria-label={t('myDayStep.skipAria')}
          >
            {t('myDayStep.skip')}
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl bg-accent-strong px-6 py-3 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-accent-hover"
            aria-label={t('captureFlow.nextAria')}
          >
            {t('captureFlow.next')}
          </button>
        </div>
      </div>
    </section>
  );
}
