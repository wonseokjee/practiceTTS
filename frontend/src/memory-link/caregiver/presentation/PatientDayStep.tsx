// Step3: 환자분의 하루 화면
//
// §9-1-A: 세이지 그린 헤더 + 크림 베이지 배경 (메인 톤)
// 카테고리별 카드 3개(활동/순간/사람·장소·음식)
// 사진 첨부(선택)
// 검증: patientAnswers ≥ 1 OR photo (둘 다 없으면 "저장" 비활성)

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DiaryQuestion,
  PatientCategory,
  PatientCategoryMeta,
} from '../domain/CaptureFlow.js';
import {
  MAX_CAREGIVER_WISH_LENGTH,
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
  /** Phase 6: 보호자가 환자에게 전하는 한마디 (선택) */
  caregiverWishMessage: string;
  onChangeWishMessage: (text: string) => void;
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
  caregiverWishMessage,
  onChangeWishMessage,
  onChangePatientAnswer,
  onSelectPhoto,
  onClearPhoto,
  onPrev,
  onSubmit,
  onRetryQuestions,
}: PatientDayStepProps) {
  const { t } = useTranslation('caregiver');
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
      className="font-pretendard rounded-xl bg-canvas p-6 sm:p-8"
      aria-labelledby="patient-step-heading"
    >
      <header className="mb-6">
        <h2
          id="patient-step-heading"
          className="text-2xl font-bold text-primary"
        >
          {t('patientDay.title')}
        </h2>
        <p className="mt-2 text-sm text-muted-sage">
          {t('patientDay.subtitle')}
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
          <h3 className="text-base font-medium text-ink-sage">
            {t('patientDay.photoTitle')}{' '}
            <span className="text-xs font-normal text-muted-sage">{t('patientDay.optional')}</span>
          </h3>
          {photo && (
            <button
              type="button"
              onClick={onClearPhoto}
              disabled={isSubmitting}
              className="text-xs text-muted-sage underline transition-colors hover:text-accent-strong disabled:opacity-50"
              aria-label={t('patientDay.removePhotoAria')}
            >
              {t('patientDay.removePhoto')}
            </button>
          )}
        </div>

        {/* 사진은 선택이지만, 첨부하면 더 풍부한 훈련 시나리오가 생성됨 */}
        <p className="mt-1 text-xs text-muted-sage">
          {t('patientDay.photoNote')}
        </p>

        {photoPreview ? (
          <img
            src={photoPreview}
            alt={t('patientDay.photoPreviewAlt')}
            className="mt-3 h-24 w-24 rounded-xl object-cover"
          />
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSubmitting}
            className="mt-3 flex h-32 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line-strong bg-canvas text-muted-sage transition-colors duration-[180ms] ease-out hover:border-primary hover:bg-primary-light disabled:opacity-50"
            aria-label={t('patientDay.selectPhotoAria')}
          >
            <span className="text-2xl" aria-hidden="true">
              +
            </span>
            <span className="text-sm">{t('patientDay.selectPhoto')}</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label={t('patientDay.selectPhotoFileAria')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSelectPhoto(file);
            // 동일 파일 재선택 가능하도록 value 초기화
            e.target.value = '';
          }}
        />
      </div>

      {/* 지금 듣고 싶은 한마디 (Phase 6, 선택) — 점선 박스로 구분 */}
      <div className="mt-6 rounded-xl border-2 border-dashed border-accent-line bg-accent-faint p-5">
        <label
          htmlFor="caregiver-wish"
          className="flex items-center gap-2 text-base font-medium text-[#7A4A20]"
        >
          <span aria-hidden="true">💌</span>
          {t('patientDay.wishTitle')}{' '}
          <span className="text-xs font-normal text-[#9A7A50]">{t('patientDay.optional')}</span>
        </label>
        <p className="mt-1 text-xs text-[#9A7A50]">
          {t('patientDay.wishNote')}
        </p>
        <textarea
          id="caregiver-wish"
          value={caregiverWishMessage}
          onChange={(e) => onChangeWishMessage(e.target.value)}
          disabled={isSubmitting}
          placeholder={t('patientDay.wishPlaceholder')}
          maxLength={MAX_CAREGIVER_WISH_LENGTH}
          rows={2}
          className="mt-3 w-full resize-none rounded-xl border border-accent-line bg-white p-3 text-sm leading-relaxed text-ink-sage focus:border-accent-strong focus:outline-none focus:ring-1 focus:ring-accent-strong disabled:bg-[#F0F1F0]"
          aria-label={t('patientDay.wishAria')}
        />
        <div className="mt-1 text-right text-xs text-[#9A7A50]" aria-live="polite">
          <span className="font-medium tabular-nums">
            {caregiverWishMessage.length}
          </span>
          {' / '}
          <span className="tabular-nums">{MAX_CAREGIVER_WISH_LENGTH}</span>
        </div>
      </div>

      {!canSubmit && !isSubmitting && (
        <p
          className="mt-4 text-xs text-muted-sage"
          aria-live="polite"
          role="status"
        >
          {t('patientDay.canSubmitHint')}
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent bg-accent-soft p-3 text-sm text-accent-ink"
        >
          <span>{error}</span>
          {hasMissingQuestion && onRetryQuestions && (
            <button
              type="button"
              onClick={onRetryQuestions}
              disabled={isSubmitting}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-accent-ink underline transition-colors hover:bg-accent-faint disabled:opacity-50"
              aria-label={t('patientDay.retryQuestionsAria')}
            >
              {t('patientDay.retryQuestions')}
            </button>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={isSubmitting}
          className="rounded-xl px-5 py-3 text-sm font-medium text-muted-sage transition-colors duration-[180ms] ease-out hover:bg-primary-light disabled:opacity-50"
          aria-label={t('captureFlow.prevAria')}
        >
          {t('captureFlow.prev')}
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="rounded-xl bg-primary px-8 py-3 text-base font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-disabled-surface disabled:text-disabled-ink"
          aria-label={isSubmitting ? t('patientDay.savingAria') : t('patientDay.saveAria')}
        >
          {isSubmitting ? t('patientDay.saving') : t('patientDay.save')}
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
  const { t } = useTranslation('caregiver');
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
          className="text-xs font-semibold uppercase tracking-wide text-primary"
        >
          {t(meta.labelKey)}
        </span>
      </div>

      <p className="mb-3 text-base font-medium text-ink-sage">
        {question ? question.text : t('myDayStep.loadingQuestion')}
      </p>

      <textarea
        value={answerText}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || !question}
        placeholder={t('patientDay.answerPlaceholder')}
        maxLength={MAX_PATIENT_ANSWER_LENGTH}
        rows={3}
        className="w-full resize-none rounded-xl border border-line-strong bg-surface-soft p-3 text-sm leading-relaxed text-ink-sage focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-[#F0F1F0]"
        aria-label={t('patientDay.categoryAnswerAria', { label: t(meta.labelKey) })}
      />

      <div className="mt-2 text-right text-xs text-muted-sage" aria-live="polite">
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
