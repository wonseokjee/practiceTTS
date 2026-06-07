// Step3: 환자분의 하루 화면
//
// §9-1-A: 세이지 그린 헤더 + 크림 베이지 배경 (메인 톤)
// 카테고리별 카드 3개(활동/순간/사람·장소·음식)
// 사진 첨부(선택)
// 검증: patientAnswers ≥ 1 OR photo (둘 다 없으면 "저장" 비활성)

import { useRef } from 'react';
import type {
  DiaryQuestion,
  PatientCategory,
  PatientCategoryMeta,
} from '../domain/CaptureFlow.js';
import {
  MAX_PATIENT_ANSWER_LENGTH,
  PATIENT_CATEGORY_META,
} from '../domain/CaptureFlow.js';
import type {
  PatientAnswerTextMap,
  PatientQuestionMap,
} from '../application/useCaptureFlow.js';

interface PatientDayStepProps {
  patientAnswers: PatientAnswerTextMap;
  patientQuestions: PatientQuestionMap;
  photo: File | null;
  photoPreview: string | null;
  isSubmitting: boolean;
  error: string | null;
  onChangePatientAnswer: (category: PatientCategory, text: string) => void;
  onSelectPhoto: (file: File) => void;
  onClearPhoto: () => void;
  onPrev: () => void;
  onSubmit: () => void;
  /** 질문 prefetch 실패 시 재시도 */
  onRetryQuestions?: () => void;
}

/**
 * 카테고리별 환자 질문 3개 + 사진 첨부(선택). 최소 1개 답변 또는 사진이 있어야 저장 가능.
 */
export function PatientDayStep({
  patientAnswers,
  patientQuestions,
  photo,
  photoPreview,
  isSubmitting,
  error,
  onChangePatientAnswer,
  onSelectPhoto,
  onClearPhoto,
  onPrev,
  onSubmit,
  onRetryQuestions,
}: PatientDayStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nonEmptyAnswerCount = countNonEmptyAnswers(patientAnswers);
  const canSubmit = !isSubmitting && (nonEmptyAnswerCount > 0 || photo !== null);
  // 한 개라도 질문 prefetch가 안 됐으면 해당 답변이 저장 시 유실되므로 재시도를 안내한다.
  const hasMissingQuestion =
    patientQuestions.activity === null ||
    patientQuestions.moment === null ||
    patientQuestions.context === null;

  return (
    <section
      className="font-pretendard rounded-xl bg-[#F7F6F3] p-6 sm:p-8"
      aria-labelledby="patient-step-heading"
    >
      <header className="mb-6">
        <h2
          id="patient-step-heading"
          className="text-2xl font-bold text-[#2D6A56]"
        >
          환자분의 하루
        </h2>
        <p className="mt-2 text-sm text-[#5C6661]">
          내일 환자분이 풀 문제를 위해 함께 기록해주세요.
        </p>
      </header>

      <div className="space-y-4">
        {PATIENT_CATEGORY_META.map((meta) => (
          <PatientCategoryCard
            key={meta.category}
            meta={meta}
            question={patientQuestions[meta.category]}
            answerText={patientAnswers[meta.category]}
            onChange={(text) => onChangePatientAnswer(meta.category, text)}
            disabled={isSubmitting}
          />
        ))}
      </div>

      {/* 사진 첨부 (옵션) */}
      <div className="mt-6 rounded-xl bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium text-[#1F2A26]">
            사진 첨부{' '}
            <span className="text-xs font-normal text-[#5C6661]">(선택)</span>
          </h3>
          {photo && (
            <button
              type="button"
              onClick={onClearPhoto}
              disabled={isSubmitting}
              className="text-xs text-[#5C6661] underline transition-colors hover:text-[#E07B54] disabled:opacity-50"
              aria-label="첨부한 사진 제거"
            >
              제거
            </button>
          )}
        </div>

        {photoPreview ? (
          <img
            src={photoPreview}
            alt="첨부된 사진 미리보기"
            className="mt-3 h-40 w-full rounded-xl object-cover"
          />
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSubmitting}
            className="mt-3 flex h-32 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[#D4D8D4] bg-[#F7F6F3] text-[#5C6661] transition-colors duration-[180ms] ease-out hover:border-[#2D6A56] hover:bg-[#EBF4F0] disabled:opacity-50"
            aria-label="사진 선택"
          >
            <span className="text-2xl" aria-hidden="true">
              +
            </span>
            <span className="text-sm">사진 선택</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label="사진 파일 선택"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSelectPhoto(file);
            // 동일 파일 재선택 가능하도록 value 초기화
            e.target.value = '';
          }}
        />
      </div>

      {!canSubmit && !isSubmitting && (
        <p
          className="mt-4 text-xs text-[#5C6661]"
          aria-live="polite"
          role="status"
        >
          답변 1개 이상 또는 사진 1장이 있어야 저장할 수 있어요.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E07B54] bg-[#FBE9E2] p-3 text-sm text-[#7A2E15]"
        >
          <span>{error}</span>
          {hasMissingQuestion && onRetryQuestions && (
            <button
              type="button"
              onClick={onRetryQuestions}
              disabled={isSubmitting}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[#7A2E15] underline transition-colors hover:bg-[#FCF3EC] disabled:opacity-50"
              aria-label="질문 다시 불러오기"
            >
              질문 다시 불러오기
            </button>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={isSubmitting}
          className="rounded-xl px-5 py-3 text-sm font-medium text-[#5C6661] transition-colors duration-[180ms] ease-out hover:bg-[#EBF4F0] disabled:opacity-50"
          aria-label="이전 단계로"
        >
          이전
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="rounded-xl bg-[#2D6A56] px-8 py-3 text-base font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240] disabled:cursor-not-allowed disabled:bg-[#C5C8C5] disabled:text-[#7A7E7A]"
          aria-label={isSubmitting ? '저장 중' : '오늘의 일기 저장'}
        >
          {isSubmitting ? '저장 중…' : '저장'}
        </button>
      </div>
    </section>
  );
}

// ── 하위 컴포넌트 ──────────────────────────────────────────────────

interface PatientCategoryCardProps {
  meta: PatientCategoryMeta;
  question: DiaryQuestion | null;
  answerText: string;
  onChange: (text: string) => void;
  disabled: boolean;
}

function PatientCategoryCard({
  meta,
  question,
  answerText,
  onChange,
  disabled,
}: PatientCategoryCardProps) {
  const charCount = answerText.length;

  return (
    <article
      className="rounded-xl bg-white p-5"
      aria-labelledby={`category-${meta.category}-label`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden="true" className="text-xl">
          {meta.emoji}
        </span>
        <span
          id={`category-${meta.category}-label`}
          className="text-xs font-semibold uppercase tracking-wide text-[#2D6A56]"
        >
          {meta.label}
        </span>
      </div>

      <p className="mb-3 text-base font-medium text-[#1F2A26]">
        {question ? question.text : '질문을 불러오는 중입니다…'}
      </p>

      <textarea
        value={answerText}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || !question}
        placeholder="짧게라도 적어주세요"
        maxLength={MAX_PATIENT_ANSWER_LENGTH}
        rows={3}
        className="w-full resize-none rounded-xl border border-[#D4D8D4] bg-[#FBFBFA] p-3 text-sm leading-relaxed text-[#1F2A26] focus:border-[#2D6A56] focus:outline-none focus:ring-1 focus:ring-[#2D6A56] disabled:bg-[#F0F1F0]"
        aria-label={`${meta.label} 카테고리 답변`}
      />

      <div className="mt-2 text-right text-xs text-[#5C6661]" aria-live="polite">
        <span className="font-medium tabular-nums">{charCount}</span>
        {' / '}
        <span className="tabular-nums">{MAX_PATIENT_ANSWER_LENGTH}</span>
      </div>
    </article>
  );
}

function countNonEmptyAnswers(answers: PatientAnswerTextMap): number {
  let count = 0;
  if (answers.activity.trim().length > 0) count++;
  if (answers.moment.trim().length > 0) count++;
  if (answers.context.trim().length > 0) count++;
  return count;
}
