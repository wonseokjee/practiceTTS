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
  /** Phase 4에서는 UI 미노출 (Phase 6 입력 UI 도입 예정) */
  caregiverWishMessage: string;
  caregiverQuestion: DiaryQuestion | null;
  patientQuestions: PatientQuestionMap;
  isSubmitting: boolean;
  error: string | null;
  /** 생성된 메모리 엔트리 (done 단계에서 사용 가능) */
  createdEntry: MemoryEntry | null;
  setMood: (level: MoodLevel) => void;
  setCaregiverAnswerText: (text: string) => void;
  setPatientAnswerText: (category: PatientCategory, text: string) => void;
  setPhoto: (file: File) => void;
  clearPhoto: () => void;
  next: () => void;
  prev: () => void;
  submit: () => Promise<void>;
  reset: () => void;
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
  // Phase 4에서는 UI 미노출 — 빈 상태 유지
  const [caregiverWishMessage] = useState<string>('');

  const [caregiverQuestion, setCaregiverQuestion] =
    useState<DiaryQuestion | null>(null);
  const [patientQuestions, setPatientQuestions] = useState<PatientQuestionMap>(
    { ...EMPTY_PATIENT_QUESTIONS },
  );

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [createdEntry, setCreatedEntry] = useState<MemoryEntry | null>(null);

  // ── 질문 prefetch (마운트 시 한 번) ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const api = questionApiRef.current;
    const prefetchAll = async (): Promise<void> => {
      try {
        const [caregiver, activity, moment, context] = await Promise.all([
          api.fetchToday({ scope: 'caregiver' }),
          api.fetchToday({ scope: 'patient', category: 'activity' }),
          api.fetchToday({ scope: 'patient', category: 'moment' }),
          api.fetchToday({ scope: 'patient', category: 'context' }),
        ]);

        if (cancelled) return;
        setCaregiverQuestion(caregiver);
        setPatientQuestions({ activity, moment, context });
      } catch (err) {
        if (cancelled) return;
        // prefetch 실패는 화면 진입 자체를 막진 않으나, 에러는 표시한다.
        setError(extractErrorMessage(err));
      }
    };

    void prefetchAll();

    return () => {
      cancelled = true;
    };
  }, []);

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
    setPatientAnswersState({ ...EMPTY_PATIENT_ANSWERS });
    setPhotoState(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setIsSubmitting(false);
    setError(null);
    setCreatedEntry(null);
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
    setMood,
    setCaregiverAnswerText,
    setPatientAnswerText,
    setPhoto,
    clearPhoto,
    next,
    prev,
    submit,
    reset,
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
