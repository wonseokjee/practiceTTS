// 보호자 3-step 캡처 화면 컨테이너
//
// §9-1-A: 단계별 헤더 색상 차별화 (Step1·3 메인 톤 / Step2 라벤더 사적 톤)
// 진행 인디케이터: ● ○ ○ → ● ● ○ → ● ● ●

import { useTranslation } from 'react-i18next';
import type { UseCaptureFlowReturn } from '../application/useCaptureFlow.js';
import { useQuizGenerationStatus } from '../application/useQuizGenerationStatus.js';
import type { CaptureStep } from '../domain/CaptureFlow.js';
import { MoodCheckStep } from './MoodCheckStep.js';
import { MyDayStep } from './MyDayStep.js';
import { PatientDayStep } from './PatientDayStep.js';

interface CaptureScreenProps {
  /** 보호자에 연결된 환자 ID — 부재 시 안내 화면 표시 */
  patientId: string;
  flow: UseCaptureFlowReturn;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * 3-step 캡처 컨테이너
 * - 비즈니스 로직은 useCaptureFlow에 모두 위임
 * - 단계 진행 + submitting/done 상태별 렌더링만 담당
 */
export function CaptureScreen({
  patientId,
  flow,
  onComplete,
  onCancel,
}: CaptureScreenProps) {
  const { t } = useTranslation('caregiver');
  const {
    step,
    mood,
    caregiverAnswerText,
    patientAnswers,
    photo,
    photoPreview,
    caregiverQuestion,
    patientQuestions,
    caregiverWishMessage,
    isSubmitting,
    error,
    setMood,
    setCaregiverAnswerText,
    setCaregiverWishMessage,
    setPatientAnswerText,
    setPhoto,
    clearPhoto,
    next,
    prev,
    submit,
    reset,
    retryQuestions,
    createdEntry,
    quizExpected,
  } = flow;

  // 환자 미연결 가드
  if (!patientId) {
    return (
      <div
        className="font-pretendard mx-auto max-w-md rounded-xl border border-accent-line bg-accent-faint p-6 text-center"
        role="alert"
      >
        <p className="text-sm text-[#7A4A20]">
          {t('captureScreen.noPatientTitle')}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 rounded-xl bg-white px-5 py-2 text-sm font-medium text-muted-sage hover:bg-canvas"
        >
          {t('captureScreen.back')}
        </button>
      </div>
    );
  }

  // 제출 중 — 풀스크린 로더
  if (step === 'submitting' || isSubmitting) {
    return <SubmittingOverlay />;
  }

  // 완료 — 퀴즈 생성 결과 폴링 카드 + 액션 버튼
  if (step === 'done') {
    return (
      <DoneCard
        memoryEntryId={createdEntry?.id ?? null}
        quizExpected={quizExpected}
        onBack={() => {
          reset();
          onComplete();
        }}
      />
    );
  }

  return (
    <div className="font-pretendard mx-auto w-full max-w-2xl">
      <StepIndicator step={step} />

      {step === 'mood' && (
        <MoodCheckStep
          mood={mood}
          onSelectMood={setMood}
          onNext={next}
          error={error}
        />
      )}

      {step === 'myDay' && (
        <MyDayStep
          question={caregiverQuestion}
          answerText={caregiverAnswerText}
          onChangeAnswerText={setCaregiverAnswerText}
          onSkip={next}
          onNext={next}
          onPrev={prev}
        />
      )}

      {step === 'patientDay' && (
        <PatientDayStep
          patientAnswers={patientAnswers}
          patientQuestions={patientQuestions}
          photo={photo}
          photoPreview={photoPreview}
          isSubmitting={isSubmitting}
          error={error}
          caregiverWishMessage={caregiverWishMessage}
          onChangeWishMessage={setCaregiverWishMessage}
          onChangePatientAnswer={setPatientAnswerText}
          onSelectPhoto={setPhoto}
          onClearPhoto={clearPhoto}
          onPrev={prev}
          onSubmit={() => void submit()}
          onRetryQuestions={retryQuestions}
        />
      )}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-sage transition-colors hover:text-[#3F4A44]"
          aria-label={t('captureScreen.cancelAria')}
        >
          {t('captureScreen.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── 하위 컴포넌트 ──────────────────────────────────────────────────

interface StepIndicatorProps {
  step: CaptureStep;
}

function StepIndicator({ step }: StepIndicatorProps) {
  const { t } = useTranslation('caregiver');
  // submitting/done은 시각상 무의미하므로 placeholder 처리
  const stepOrder: CaptureStep[] = ['mood', 'myDay', 'patientDay'];
  const currentIndex = stepOrder.indexOf(step);
  const safeIndex = currentIndex < 0 ? stepOrder.length - 1 : currentIndex;

  return (
    <div
      className="mb-6 flex items-center justify-center gap-2"
      role="progressbar"
      aria-valuenow={safeIndex + 1}
      aria-valuemin={1}
      aria-valuemax={stepOrder.length}
      aria-label={t('captureScreen.stepAria', { step: safeIndex + 1, total: stepOrder.length })}
    >
      {stepOrder.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`block h-2.5 w-2.5 rounded-full transition-colors duration-[180ms] ease-out ${
              i <= safeIndex ? 'bg-primary' : 'bg-line-strong'
            }`}
            aria-hidden="true"
          />
          {i < stepOrder.length - 1 && (
            <span
              className={`block h-px w-6 transition-colors duration-[180ms] ease-out ${
                i < safeIndex ? 'bg-primary' : 'bg-line-strong'
              }`}
              aria-hidden="true"
            />
          )}
        </div>
      ))}
      <span className="ml-3 text-xs tabular-nums text-muted-sage">
        {safeIndex + 1} / {stepOrder.length}
      </span>
    </div>
  );
}

function SubmittingOverlay() {
  const { t } = useTranslation('caregiver');
  return (
    <div
      className="font-pretendard fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas/95 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div
        className="mb-6 h-14 w-14 animate-pulse rounded-full bg-primary"
        aria-hidden="true"
      />
      <p className="text-lg font-medium text-ink-sage">
        {t('captureScreen.aiGenerating')}
      </p>
      <p className="mt-2 text-sm text-muted-sage">
        {t('captureScreen.aiGeneratingSub')}
      </p>
    </div>
  );
}

interface DoneCardProps {
  memoryEntryId: string | null;
  quizExpected: boolean;
  onBack: () => void;
}

/**
 * 저장 완료 카드. 퀴즈 자동생성이 기대되는 경우(quizExpected) 생성 결과를 폴링하여
 * 진행/성공/실패를 정직하게 표시한다. 실패 시 재시도 버튼을 제공한다.
 *
 *   idle/ready  → "문제가 도착했어요" (성공 또는 퀴즈 미기대)
 *   pending     → "AI가 문제를 만들고 있어요" (스피너)
 *   failed      → 사유 + "다시 만들기"
 *   timeout     → "조금 더 걸리고 있어요" + "다시 확인"
 */
function DoneCard({ memoryEntryId, quizExpected, onBack }: DoneCardProps) {
  const { t } = useTranslation('caregiver');
  const { status, error, retry } = useQuizGenerationStatus(
    memoryEntryId,
    quizExpected,
  );

  const isFailed = status === 'failed';
  const isPending = status === 'pending';
  const isTimeout = status === 'timeout';

  const headline = isFailed
    ? t('captureScreen.doneFailedHeadline')
    : t('captureScreen.doneSavedHeadline');

  const bgClass = isFailed ? 'bg-accent-soft' : 'bg-primary-light';
  const iconBgClass = isFailed ? 'bg-accent' : 'bg-primary';
  const headlineColor = isFailed ? 'text-accent-ink' : 'text-primary-dark';

  let body: string;
  if (isFailed) {
    body = error ?? t('captureScreen.doneFailedBodyFallback');
  } else if (isPending) {
    body = t('captureScreen.donePendingBody');
  } else if (isTimeout) {
    body = t('captureScreen.doneTimeoutBody');
  } else {
    // idle(퀴즈 미기대) 또는 ready
    body = quizExpected
      ? t('captureScreen.doneReadyBody')
      : t('captureScreen.doneIdleBody');
  }

  return (
    <section
      className={`font-pretendard mx-auto max-w-md rounded-xl ${bgClass} p-8 text-center`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-white ${iconBgClass}`}
        aria-hidden="true"
      >
        {isPending ? (
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : (
          <span className="text-3xl">{isFailed ? '!' : '✓'}</span>
        )}
      </div>
      <h2 className={`text-xl font-bold ${headlineColor}`}>{headline}</h2>
      <p className="mt-2 text-sm text-muted-sage">{body}</p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {(isFailed || isTimeout) && (
          <button
            type="button"
            onClick={retry}
            className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark"
            aria-label={isFailed ? t('captureScreen.retryAria') : t('captureScreen.retryCheckAria')}
          >
            {isFailed ? t('captureScreen.retry') : t('captureScreen.retryCheck')}
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className={
            isFailed || isTimeout
              ? 'rounded-xl bg-white px-6 py-3 text-sm font-medium text-muted-sage transition-colors hover:bg-canvas'
              : 'rounded-xl bg-primary px-6 py-3 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark'
          }
          aria-label={t('captureScreen.backToDashboardAria')}
        >
          {t('captureScreen.backToDashboard')}
        </button>
      </div>
    </section>
  );
}
