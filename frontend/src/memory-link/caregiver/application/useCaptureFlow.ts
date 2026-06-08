// 보호자 3-step 캡처 플로우 FSM 훅
//
// Implementation Plan §2-4(흐름) / §7-1(API) / §9-1-A(화면 명세) 준수
// FSM: mood → myDay → patientDay → submitting → done | (실패 시 직전 단계로 복귀)
//
// 진행 차단 정책:
//   mood:        mood === null
//   myDay:       (없음 — 건너뛰기 허용)
//   patientDay:  patientAnswers ≥ 1 OR photo 첨부 (백엔드 OR 검증 일관성)

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CaptureStep,
  DiaryQuestion,
  MoodLevel,
  PatientCategory,
} from '../domain/CaptureFlow.js';
import {
  MAX_CAREGIVER_ANSWER_LENGTH,
  MAX_CAREGIVER_WISH_LENGTH,
  MAX_PATIENT_ANSWER_LENGTH,
} from '../domain/CaptureFlow.js';
import type { MemoryEntry } from '../domain/MemoryEntry.js';
import { diaryQuestionApi } from '../infrastructure/DiaryQuestionApi.js';
import type { IDiaryQuestionApi } from '../infrastructure/DiaryQuestionApi.js';
import { memoryEntryApi } from '../infrastructure/MemoryEntryApi.js';
import type { IMemoryEntryApi } from '../infrastructure/MemoryEntryApi.js';

/** 카테고리별 답변 텍스트 상태 */
export interface PatientAnswerTextMap {
  activity: string;
  moment: string;
  context: string;
}

/** 카테고리별 prefetch된 질문 상태 */
export interface PatientQuestionMap {
  activity: DiaryQuestion | null;
  moment: DiaryQuestion | null;
  context: DiaryQuestion | null;
}

export interface UseCaptureFlowReturn {
  step: CaptureStep;
  mood: MoodLevel | null;
  caregiverAnswerText: string;
  patientAnswers: PatientAnswerTextMap;
  photo: File | null;
  photoPreview: string | null;
  /** Phase 6: 보호자가 환자에게 전하는 한마디 (선택) */
  caregiverWishMessage: string;
  caregiverQuestion: DiaryQuestion | null;
  patientQuestions: PatientQuestionMap;
  isSubmitting: boolean;
  error: string | null;
  /** 생성된 메모리 엔트리 (done 단계에서 사용 가능) */
  createdEntry: MemoryEntry | null;
  /** 이번 제출로 퀴즈 자동생성이 기대되는지 (노트 ≥ 1). done 화면 폴링 게이트. */
  quizExpected: boolean;
  setMood: (level: MoodLevel) => void;
  setCaregiverAnswerText: (text: string) => void;
  setCaregiverWishMessage: (text: string) => void;
  setPatientAnswerText: (category: PatientCategory, text: string) => void;
  setPhoto: (file: File) => void;
  clearPhoto: () => void;
  next: () => void;
  prev: () => void;
  submit: () => Promise<void>;
  reset: () => void;
  /** 질문 prefetch 실패 시 재시도 (PatientDayStep의 재시도 버튼용) */
  retryQuestions: () => void;
}

/** 선택적 의존성 주입 (테스트 용이성) */
export interface UseCaptureFlowDeps {
  memoryEntryApi?: IMemoryEntryApi;
  diaryQuestionApi?: IDiaryQuestionApi;
}

const EMPTY_PATIENT_ANSWERS: PatientAnswerTextMap = Object.freeze({
  activity: '',
  moment: '',
  context: '',
});

const EMPTY_PATIENT_QUESTIONS: PatientQuestionMap = Object.freeze({
  activity: null,
  moment: null,
  context: null,
});

/**
 * 3-step 캡처 플로우 상태 관리 훅
 *
 * @param patientId 보호자의 환자 ID (AuthContext.user.patientId)
 * @param deps      테스트 시 의존성 주입 (선택)
 */
export function useCaptureFlow(
  patientId: string,
  deps?: UseCaptureFlowDeps,
): UseCaptureFlowReturn {
  // 의존성은 ref에 저장하여 useEffect deps에 포함시키지 않는다.
  // (테스트에서 매 렌더 새 객체로 주입돼도 prefetch가 1회만 수행되도록 안정화)
  const entryApiRef = useRef<IMemoryEntryApi>(
    deps?.memoryEntryApi ?? memoryEntryApi,
  );
  const questionApiRef = useRef<IDiaryQuestionApi>(
    deps?.diaryQuestionApi ?? diaryQuestionApi,
  );

  const [step, setStep] = useState<CaptureStep>('mood');
  const [mood, setMoodState] = useState<MoodLevel | null>(null);
  const [caregiverAnswerText, setCaregiverAnswerTextState] = useState<string>('');
  const [patientAnswers, setPatientAnswersState] =
    useState<PatientAnswerTextMap>({ ...EMPTY_PATIENT_ANSWERS });
  const [photo, setPhotoState] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [caregiverWishMessage, setCaregiverWishMessageState] =
    useState<string>('');

  const [caregiverQuestion, setCaregiverQuestion] =
    useState<DiaryQuestion | null>(null);
  const [patientQuestions, setPatientQuestions] = useState<PatientQuestionMap>(
    { ...EMPTY_PATIENT_QUESTIONS },
  );

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [createdEntry, setCreatedEntry] = useState<MemoryEntry | null>(null);
  const [quizExpected, setQuizExpected] = useState<boolean>(false);

  // ── 질문 prefetch (마운트 시 한 번, 실패 시 재시도 가능) ──────────
  const prefetchQuestions = useCallback(
    async (isCancelled?: () => boolean): Promise<void> => {
      const api = questionApiRef.current;
      try {
        const [caregiver, activity, moment, context] = await Promise.all([
          api.fetchToday({ scope: 'caregiver' }),
          api.fetchToday({ scope: 'patient', category: 'activity' }),
          api.fetchToday({ scope: 'patient', category: 'moment' }),
          api.fetchToday({ scope: 'patient', category: 'context' }),
        ]);

        if (isCancelled?.()) return;
        setCaregiverQuestion(caregiver);
        setPatientQuestions({ activity, moment, context });
        // 성공 시 error를 건드리지 않는다 — 마운트 prefetch가 늦게 끝나며
        // 사용자가 보고 있는 다른 검증 에러를 덮어쓰지 않도록 한다.
        // (prefetch 에러는 retryQuestions가 시작 시점에 직접 클리어한다.)
      } catch (err) {
        if (isCancelled?.()) return;
        // prefetch 실패는 화면 진입 자체를 막진 않으나, 에러를 표시하고
        // 제출 시점(submit)에서 답변 유실을 방지하도록 한다.
        setError(extractErrorMessage(err));
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void prefetchQuestions(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [prefetchQuestions]);

  const retryQuestions = useCallback((): void => {
    // 재시도 시작 시점에 직전 prefetch 에러를 클리어한다.
    setError(null);
    void prefetchQuestions();
  }, [prefetchQuestions]);

  // ── 액션 ────────────────────────────────────────────────────────

  const setMood = useCallback((level: MoodLevel) => {
    setMoodState(level);
    setError(null);
  }, []);

  const setCaregiverAnswerText = useCallback((text: string) => {
    // 300자 제한 — 초과 입력은 잘라낸다 (controlled input).
    const truncated =
      text.length > MAX_CAREGIVER_ANSWER_LENGTH
        ? text.slice(0, MAX_CAREGIVER_ANSWER_LENGTH)
        : text;
    setCaregiverAnswerTextState(truncated);
  }, []);

  const setCaregiverWishMessage = useCallback((text: string) => {
    const truncated =
      text.length > MAX_CAREGIVER_WISH_LENGTH
        ? text.slice(0, MAX_CAREGIVER_WISH_LENGTH)
        : text;
    setCaregiverWishMessageState(truncated);
  }, []);

  const setPatientAnswerText = useCallback(
    (category: PatientCategory, text: string) => {
      const truncated =
        text.length > MAX_PATIENT_ANSWER_LENGTH
          ? text.slice(0, MAX_PATIENT_ANSWER_LENGTH)
          : text;
      setPatientAnswersState((prev) => ({ ...prev, [category]: truncated }));
    },
    [],
  );

  const setPhoto = useCallback((file: File) => {
    setPhotoState(file);
    // 기존 미리보기 URL 해제 후 새 URL 생성
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setError(null);
  }, []);

  const clearPhoto = useCallback(() => {
    setPhotoState(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  /** 다음 단계로 진행 (검증 실패 시 step 유지 + error 표시) */
  const next = useCallback(() => {
    setError(null);

    if (step === 'mood') {
      if (mood === null) {
        setError('오늘의 마음을 선택해주세요.');
        return;
      }
      setStep('myDay');
      return;
    }

    if (step === 'myDay') {
      // 건너뛰기 허용 — 검증 없음
      setStep('patientDay');
      return;
    }

    // patientDay에서의 next()는 submit()으로 위임
  }, [step, mood]);

  /** 이전 단계로 복귀 */
  const prev = useCallback(() => {
    setError(null);
    if (step === 'myDay') {
      setStep('mood');
      return;
    }
    if (step === 'patientDay') {
      setStep('myDay');
      return;
    }
  }, [step]);

  /** 최종 제출 */
  const submit = useCallback(async (): Promise<void> => {
    setError(null);

    if (!patientId) {
      setError('연결된 환자가 없습니다.');
      return;
    }
    if (mood === null) {
      setError('오늘의 마음을 먼저 선택해주세요.');
      return;
    }

    // prefetch 실패로 질문 id가 없으면 입력한 답변이 조용히 유실되므로 먼저 차단한다.
    // (collectNonEmptyPatientAnswers는 question이 없는 답변을 버리기 때문)
    const categories: PatientCategory[] = ['activity', 'moment', 'context'];
    const hasTypedButUnmappedAnswer = categories.some(
      (category) =>
        patientAnswers[category].trim().length > 0 &&
        !patientQuestions[category],
    );
    if (hasTypedButUnmappedAnswer) {
      setError(
        '질문을 불러오지 못해 답변을 저장할 수 없어요. 다시 시도해주세요.',
      );
      return;
    }

    // patientAnswers ≥ 1 OR photo (백엔드 OR 검증과 일관)
    const nonEmptyPatientAnswers = collectNonEmptyPatientAnswers(
      patientAnswers,
      patientQuestions,
    );
    if (nonEmptyPatientAnswers.length === 0 && !photo) {
      setError(
        '환자분의 하루 답변 1개 이상 또는 사진 첨부 중 하나는 필요해요.',
      );
      return;
    }

    setIsSubmitting(true);
    setStep('submitting');

    try {
      const trimmedCaregiverAnswer = caregiverAnswerText.trim();
      const trimmedWishMessage = caregiverWishMessage.trim();

      const entry = await entryApiRef.current.create({
        patientId,
        mood: { level: mood },
        patientAnswers: nonEmptyPatientAnswers,
        caregiverAnswer:
          trimmedCaregiverAnswer.length > 0 && caregiverQuestion
            ? {
                questionId: caregiverQuestion.id,
                answerText: trimmedCaregiverAnswer,
              }
            : undefined,
        caregiverWishMessage:
          trimmedWishMessage.length > 0 ? trimmedWishMessage : undefined,
        photo: photo ?? undefined,
      });

      setCreatedEntry(entry);
      // 노트가 1개 이상일 때만 백엔드가 퀴즈 생성을 트리거하므로,
      // done 화면에서 그 경우에만 생성 결과를 폴링한다.
      setQuizExpected(nonEmptyPatientAnswers.length > 0);
      setStep('done');
    } catch (err) {
      setError(extractErrorMessage(err));
      setStep('patientDay'); // 실패 시 직전 단계 복귀
    } finally {
      setIsSubmitting(false);
    }
  }, [
    patientId,
    mood,
    patientAnswers,
    patientQuestions,
    photo,
    caregiverAnswerText,
    caregiverQuestion,
    caregiverWishMessage,
  ]);

  /** 전체 상태 초기화 */
  const reset = useCallback(() => {
    setStep('mood');
    setMoodState(null);
    setCaregiverAnswerTextState('');
    setCaregiverWishMessageState('');
    setPatientAnswersState({ ...EMPTY_PATIENT_ANSWERS });
    setPhotoState(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setIsSubmitting(false);
    setError(null);
    setCreatedEntry(null);
    setQuizExpected(false);
    // 질문 prefetch 결과는 유지 (다음 캡처에 재사용)
  }, []);

  return {
    step,
    mood,
    caregiverAnswerText,
    patientAnswers,
    photo,
    photoPreview,
    caregiverWishMessage,
    caregiverQuestion,
    patientQuestions,
    isSubmitting,
    error,
    createdEntry,
    quizExpected,
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
  };
}

// ── 헬퍼 ──────────────────────────────────────────────────────────

/** 빈 답변 제외 + questionId 부착 → 백엔드 페이로드 형태로 변환 */
function collectNonEmptyPatientAnswers(
  answers: PatientAnswerTextMap,
  questions: PatientQuestionMap,
): Array<{
  questionId: string;
  category: PatientCategory;
  answerText: string;
}> {
  const categories: PatientCategory[] = ['activity', 'moment', 'context'];
  const out: Array<{
    questionId: string;
    category: PatientCategory;
    answerText: string;
  }> = [];

  for (const category of categories) {
    const text = answers[category].trim();
    const question = questions[category];
    if (text.length === 0 || !question) continue;
    out.push({
      questionId: question.id,
      category,
      answerText: text,
    });
  }

  return out;
}

/** Axios 또는 일반 에러에서 메시지를 안전하게 추출 */
function extractErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.response === 'object' && obj.response !== null) {
      const res = obj.response as Record<string, unknown>;
      if (typeof res.data === 'object' && res.data !== null) {
        const data = res.data as Record<string, unknown>;
        if (typeof data.message === 'string') return data.message;
      }
    }
    if (err instanceof Error) return err.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}
