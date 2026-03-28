import { useCallback, useState } from 'react';
import type { EmotionTag, MemoryEntry } from '../domain/MemoryEntry.js';
import { MAX_TARGET_WORDS } from '../domain/MemoryEntry.js';
import { memoryEntryApi } from '../infrastructure/MemoryEntryApi.js';

/** 캡처 플로우 단계 */
export type CaptureStep = 'photo' | 'emotion' | 'words' | 'submitting' | 'done';

export interface UseCaptureFlowReturn {
  step: CaptureStep;
  photoPreview: string | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];
  error: string | null;
  isSubmitting: boolean;
  /** 생성된 메모리 엔트리 (done 단계에서 사용 가능) */
  createdEntry: MemoryEntry | null;
  setPhoto: (file: File) => void;
  setEmotionTag: (tag: EmotionTag) => void;
  addTargetWord: (word: string) => void;
  removeTargetWord: (word: string) => void;
  submit: () => Promise<void>;
  reset: () => void;
}

const MAX_WORDS = MAX_TARGET_WORDS;

/**
 * 3단계 캡처 플로우 상태 관리 훅
 * - 단계: 사진 선택 → 감정 태그 → 목표 단어 → 제출 → 완료
 * - 비즈니스 규칙: 목표 단어 최대 3개
 */
export function useCaptureFlow(patientId: string): UseCaptureFlowReturn {
  const [step, setStep] = useState<CaptureStep>('photo');
  const [photo, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [emotionTag, setEmotionTagState] = useState<EmotionTag | null>(null);
  const [targetWords, setTargetWords] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [createdEntry, setCreatedEntry] = useState<MemoryEntry | null>(null);

  /** 사진 선택: 미리보기 URL 생성 후 emotion 단계로 전이 */
  const setPhoto = useCallback((file: File) => {
    setPhotoFile(file);
    // 기존 미리보기 URL 해제 후 새 URL 생성
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setStep('emotion');
    setError(null);
  }, []);

  /** 감정 태그 선택 후 words 단계로 전이 */
  const setEmotionTag = useCallback((tag: EmotionTag) => {
    setEmotionTagState(tag);
    setStep('words');
    setError(null);
  }, []);

  /** 목표 단어 추가 (최대 3개 초과 시 무시) */
  const addTargetWord = useCallback((word: string) => {
    const trimmed = word.trim();
    if (!trimmed) return;

    setTargetWords((prev) => {
      if (prev.length >= MAX_WORDS) return prev; // 불변 조건: 최대 3개
      if (prev.includes(trimmed)) return prev; // 중복 무시
      return [...prev, trimmed];
    });
  }, []);

  /** 목표 단어 제거 */
  const removeTargetWord = useCallback((word: string) => {
    setTargetWords((prev) => prev.filter((w) => w !== word));
  }, []);

  /** 제출: API 호출 및 done 단계 전이 */
  const submit = useCallback(async (): Promise<void> => {
    if (!photo) {
      setError('사진을 선택해주세요.');
      return;
    }

    setIsSubmitting(true);
    setStep('submitting');
    setError(null);

    try {
      const entry = await memoryEntryApi.create({
        patientId,
        photo,
        emotionTag: emotionTag ?? undefined,
        targetWords: targetWords.length > 0 ? targetWords : undefined,
      });
      setCreatedEntry(entry);
      setStep('done');
    } catch (err) {
      setError(extractErrorMessage(err));
      setStep('words'); // 실패 시 words 단계로 되돌림
    } finally {
      setIsSubmitting(false);
    }
  }, [photo, patientId, emotionTag, targetWords]);

  /** 전체 상태 초기화 */
  const reset = useCallback(() => {
    setStep('photo');
    setPhotoFile(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setEmotionTagState(null);
    setTargetWords([]);
    setError(null);
    setIsSubmitting(false);
    setCreatedEntry(null);
  }, []);

  return {
    step,
    photoPreview,
    emotionTag,
    targetWords,
    error,
    isSubmitting,
    createdEntry,
    setPhoto,
    setEmotionTag,
    addTargetWord,
    removeTargetWord,
    submit,
    reset,
  };
}

/** Axios 또는 일반 에러에서 메시지를 안전하게 추출 */
function extractErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (
      typeof obj.response === 'object' &&
      obj.response !== null
    ) {
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
