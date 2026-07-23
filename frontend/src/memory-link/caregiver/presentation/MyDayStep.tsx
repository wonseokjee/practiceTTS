// Step2: 나의 하루 화면 (보호자 사적 영역)
//
// §9-1-A: 연한 라벤더/뉴트럴 톤(#F0EEF5)으로 시각 차별화 — LLM 미전달 영역
// 자물쇠 아이콘 + "보호자 본인만 볼 수 있어요" 캡션
// 건너뛰기 허용

import type { DiaryQuestion } from '../domain/CaptureFlow.js';
import { MAX_CAREGIVER_ANSWER_LENGTH } from '../domain/CaptureFlow.js';

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
 * - 시각 톤: 메인 톤(세이지+크림)이 아닌 라벤더 뉴트럴 (#F5F3FA)로 사적 공간 강조
 */
export function MyDayStep({
  question,
  answerText,
  onChangeAnswerText,
  onSkip,
  onNext,
  onPrev,
}: MyDayStepProps) {
  const charCount = answerText.length;

  return (
    <section
      className="font-pretendard rounded-xl bg-[#F5F3FA] p-6 sm:p-8"
      aria-labelledby="myday-step-heading"
    >
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">
            🔒
          </span>
          <h2
            id="myday-step-heading"
            className="text-2xl font-bold text-[#3A2E5C]"
          >
            나의 하루
          </h2>
        </div>
        <p className="mt-2 text-sm text-[#5C5870]">
          여기에 적은 답은 보호자 본인만 볼 수 있어요.
        </p>
      </header>

      <div className="rounded-xl bg-white p-5">
        <p className="text-base font-medium text-[#1F2A26]">
          {question ? question.text : '질문을 불러오는 중입니다…'}
        </p>

        <label className="mt-4 block">
          <span className="sr-only">보호자 자기 답변 입력</span>
          <textarea
            value={answerText}
            onChange={(e) => onChangeAnswerText(e.target.value)}
            disabled={!question}
            placeholder="자유롭게 적어주세요 (선택)"
            maxLength={MAX_CAREGIVER_ANSWER_LENGTH}
            rows={5}
            className="w-full resize-none rounded-xl border border-[#D9D5E0] bg-[#FBFAFE] p-3 text-sm leading-relaxed text-[#1F2A26] focus:border-[#6B5BA8] focus:outline-none focus:ring-1 focus:ring-[#6B5BA8] disabled:bg-[#F0EEF5]"
            aria-label="나의 하루 답변"
          />
        </label>

        <div
          className="mt-2 text-right text-xs text-[#5C5870]"
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
          className="rounded-xl px-5 py-3 text-sm font-medium text-[#5C5870] transition-colors duration-[180ms] ease-out hover:bg-[#E8E4F0]"
          aria-label="이전 단계로"
        >
          이전
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-xl border border-[#D9D5E0] bg-white px-5 py-3 text-sm font-medium text-[#5C5870] transition-colors duration-[180ms] ease-out hover:bg-[#F0EEF5]"
            aria-label="이 단계 건너뛰기"
          >
            건너뛰기
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl bg-[#6B5BA8] px-6 py-3 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#564A88]"
            aria-label="다음 단계로 이동"
          >
            다음
          </button>
        </div>
      </div>
    </section>
  );
}
