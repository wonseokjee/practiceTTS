// 보호자 3-step 캡처 화면 컨테이너
//
// §9-1-A: 단계별 헤더 색상 차별화 (Step1·3 메인 톤 / Step2 라벤더 사적 톤)
// 진행 인디케이터: ● ○ ○ → ● ● ○ → ● ● ●

import type { UseCaptureFlowReturn } from '../application/useCaptureFlow.js';
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
  const {
    step,
    mood,
    caregiverAnswerText,
    patientAnswers,
    photo,
    photoPreview,
    caregiverQuestion,
    patientQuestions,
    isSubmitting,
    error,
    setMood,
    setCaregiverAnswerText,
    setPatientAnswerText,
    setPhoto,
    clearPhoto,
    next,
    prev,
    submit,
    reset,
  } = flow;

  // 환자 미연결 가드
  if (!patientId) {
    return (
      <div
        className="font-pretendard mx-auto max-w-md rounded-xl border border-[#E0A984] bg-[#FCF3EC] p-6 text-center"
        role="alert"
      >
        <p className="text-sm text-[#7A4A20]">
          연결된 환자가 없습니다. 관리자에게 연결을 요청해주세요.
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 rounded-xl bg-white px-5 py-2 text-sm font-medium text-[#5C6661] hover:bg-[#F7F6F3]"
        >
          돌아가기
        </button>
      </div>
    );
  }

  // 제출 중 — 풀스크린 로더
  if (step === 'submitting' || isSubmitting) {
    return <SubmittingOverlay />;
  }

  // 완료 — 카드 + 액션 버튼
  if (step === 'done') {
    return (
      <DoneCard
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
          onChangePatientAnswer={setPatientAnswerText}
          onSelectPhoto={setPhoto}
          onClearPhoto={clearPhoto}
          onPrev={prev}
          onSubmit={() => void submit()}
        />
      )}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[#A8AFA9] transition-colors hover:text-[#5C6661]"
          aria-label="캡처 취소"
        >
          취소하고 목록으로
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
      aria-label={`진행 단계 ${safeIndex + 1} / ${stepOrder.length}`}
    >
      {stepOrder.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`block h-2.5 w-2.5 rounded-full transition-colors duration-[180ms] ease-out ${
              i <= safeIndex ? 'bg-[#2D6A56]' : 'bg-[#D4D8D4]'
            }`}
            aria-hidden="true"
          />
          {i < stepOrder.length - 1 && (
            <span
              className={`block h-px w-6 transition-colors duration-[180ms] ease-out ${
                i < safeIndex ? 'bg-[#2D6A56]' : 'bg-[#D4D8D4]'
              }`}
              aria-hidden="true"
            />
          )}
        </div>
      ))}
      <span className="ml-3 text-xs tabular-nums text-[#5C6661]">
        {safeIndex + 1} / {stepOrder.length}
      </span>
    </div>
  );
}

function SubmittingOverlay() {
  return (
    <div
      className="font-pretendard fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#F7F6F3]/95 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div
        className="mb-6 h-14 w-14 animate-pulse rounded-full bg-[#2D6A56]"
        aria-hidden="true"
      />
      <p className="text-lg font-medium text-[#1F2A26]">
        AI가 문제를 만들고 있어요
      </p>
      <p className="mt-2 text-sm text-[#5C6661]">
        잠시만 기다려주세요. 보통 10~20초 정도 걸려요.
      </p>
    </div>
  );
}

interface DoneCardProps {
  onBack: () => void;
}

function DoneCard({ onBack }: DoneCardProps) {
  return (
    <section
      className="font-pretendard mx-auto max-w-md rounded-xl bg-[#EBF4F0] p-8 text-center"
      role="status"
    >
      <div
        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#2D6A56] text-white"
        aria-hidden="true"
      >
        <span className="text-3xl">✓</span>
      </div>
      <h2 className="text-xl font-bold text-[#1F5240]">
        오늘의 일기가 저장되었어요
      </h2>
      <p className="mt-2 text-sm text-[#5C6661]">
        환자분이 풀 수 있는 문제로 곧 도착해요.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-6 rounded-xl bg-[#2D6A56] px-6 py-3 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240]"
        aria-label="대시보드로 돌아가기"
      >
        대시보드로
      </button>
    </section>
  );
}
