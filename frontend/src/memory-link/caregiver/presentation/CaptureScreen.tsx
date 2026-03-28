import { useRef, useState } from 'react';
import type { EmotionTag } from '../domain/MemoryEntry.js';
import {
  EMOTION_TAG_LABELS,
  MAX_TARGET_WORDS,
  VALID_EMOTION_TAGS,
} from '../domain/MemoryEntry.js';
import type { UseCaptureFlowReturn } from '../application/useCaptureFlow.js';

interface CaptureScreenProps {
  patientId: string;
  flow: UseCaptureFlowReturn;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * 메모리 엔트리 생성 3단계 UI
 * 단계: 사진 선택 → 감정 태그 선택 → 목표 단어 입력 → 제출
 * - 비즈니스 로직 없음 (useCaptureFlow 훅에 위임)
 */
export function CaptureScreen({
  flow,
  onComplete,
  onCancel,
}: CaptureScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [wordInput, setWordInput] = useState('');

  const {
    step,
    photoPreview,
    emotionTag,
    targetWords,
    error,
    isSubmitting,
    setPhoto,
    setEmotionTag,
    addTargetWord,
    removeTargetWord,
    submit,
    reset,
  } = flow;

  // 완료 상태 처리
  if (step === 'done') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
        <div
          className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4"
          aria-hidden="true"
        >
          <span className="text-3xl">✓</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          기억이 저장되었습니다
        </h2>
        <p className="text-gray-500 mb-6 text-sm">
          AI가 사진을 분석하고 있습니다. 잠시 후 목록에서 확인하세요.
        </p>
        <button
          type="button"
          onClick={() => {
            reset();
            onComplete();
          }}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto p-4">
      {/* 단계 인디케이터 */}
      <StepIndicator step={step} />

      {/* 에러 메시지 */}
      {error && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
        >
          {error}
        </div>
      )}

      {/* Step 1: 사진 선택 */}
      {step === 'photo' && (
        <PhotoStep
          fileInputRef={fileInputRef}
          onFileSelected={setPhoto}
          onCancel={onCancel}
        />
      )}

      {/* Step 2: 감정 태그 선택 */}
      {step === 'emotion' && (
        <EmotionStep
          photoPreview={photoPreview}
          selectedEmotionTag={emotionTag}
          onSelect={setEmotionTag}
          onCancel={onCancel}
        />
      )}

      {/* Step 3: 목표 단어 입력 */}
      {(step === 'words' || step === 'submitting') && (
        <WordsStep
          photoPreview={photoPreview}
          emotionTag={emotionTag}
          targetWords={targetWords}
          wordInput={wordInput}
          isSubmitting={isSubmitting}
          onWordInputChange={setWordInput}
          onAddWord={() => {
            if (wordInput.trim()) {
              addTargetWord(wordInput.trim());
              setWordInput('');
            }
          }}
          onRemoveWord={removeTargetWord}
          onSubmit={submit}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

// ─── 하위 컴포넌트들 ────────────────────────────────────────────

interface StepIndicatorProps {
  step: string;
}

function StepIndicator({ step }: StepIndicatorProps) {
  const steps = ['photo', 'emotion', 'words'];
  const currentIndex = steps.indexOf(step === 'submitting' ? 'words' : step);

  return (
    <div className="flex justify-center gap-2 mb-6" aria-label="진행 단계">
      {steps.map((s, i) => (
        <div
          key={s}
          className={`w-2.5 h-2.5 rounded-full transition-colors ${
            i <= currentIndex ? 'bg-blue-500' : 'bg-gray-200'
          }`}
          aria-label={`${i + 1}단계 ${i <= currentIndex ? '완료' : '대기'}`}
        />
      ))}
    </div>
  );
}

interface PhotoStepProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelected: (file: File) => void;
  onCancel: () => void;
}

function PhotoStep({ fileInputRef, onFileSelected, onCancel }: PhotoStepProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <h2 className="text-lg font-bold text-gray-900">사진을 선택하세요</h2>
      <p className="text-sm text-gray-500">JPEG, PNG, WEBP 형식, 최대 5MB</p>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-full h-48 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
        aria-label="사진 선택"
      >
        <span className="text-4xl text-gray-300" aria-hidden="true">+</span>
        <span className="text-sm text-gray-400">사진 선택하기</span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="사진 파일 선택"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
        }}
      />

      <button
        type="button"
        onClick={onCancel}
        className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        취소
      </button>
    </div>
  );
}

interface EmotionStepProps {
  photoPreview: string | null;
  selectedEmotionTag: EmotionTag | null;
  onSelect: (tag: EmotionTag) => void;
  onCancel: () => void;
}

function EmotionStep({
  photoPreview,
  selectedEmotionTag,
  onSelect,
  onCancel,
}: EmotionStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-900 text-center">
        이 기억의 감정을 선택하세요
      </h2>

      {photoPreview && (
        <img
          src={photoPreview}
          alt="선택된 사진 미리보기"
          className="w-full h-40 object-cover rounded-xl"
        />
      )}

      <div
        className="grid grid-cols-2 gap-3"
        role="group"
        aria-label="감정 태그 선택"
      >
        {VALID_EMOTION_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onSelect(tag)}
            className={`p-4 rounded-xl border-2 font-medium transition-all ${
              selectedEmotionTag === tag
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
            }`}
            aria-pressed={selectedEmotionTag === tag}
          >
            {EMOTION_TAG_LABELS[tag]}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="text-sm text-gray-400 hover:text-gray-600 transition-colors text-center"
      >
        취소
      </button>
    </div>
  );
}

interface WordsStepProps {
  photoPreview: string | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];
  wordInput: string;
  isSubmitting: boolean;
  onWordInputChange: (value: string) => void;
  onAddWord: () => void;
  onRemoveWord: (word: string) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}

function WordsStep({
  photoPreview,
  emotionTag,
  targetWords,
  wordInput,
  isSubmitting,
  onWordInputChange,
  onAddWord,
  onRemoveWord,
  onSubmit,
  onCancel,
}: WordsStepProps) {
  const isMaxWords = targetWords.length >= MAX_TARGET_WORDS;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-900 text-center">
        훈련 목표 단어를 입력하세요
      </h2>
      <p className="text-sm text-gray-500 text-center">
        최대 {MAX_TARGET_WORDS}개까지 입력 가능합니다 (선택 사항)
      </p>

      {/* 요약 정보 */}
      <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
        {photoPreview && (
          <img
            src={photoPreview}
            alt="선택된 사진 미리보기"
            className="w-12 h-12 object-cover rounded-lg flex-shrink-0"
          />
        )}
        {emotionTag && (
          <span className="text-sm text-gray-600">
            감정: <span className="font-medium">{EMOTION_TAG_LABELS[emotionTag]}</span>
          </span>
        )}
      </div>

      {/* 단어 입력 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={wordInput}
          onChange={(e) => onWordInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAddWord();
            }
          }}
          placeholder="단어를 입력하세요"
          disabled={isMaxWords || isSubmitting}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400 disabled:bg-gray-50"
          aria-label="목표 단어 입력"
          maxLength={20}
        />
        <button
          type="button"
          onClick={onAddWord}
          disabled={isMaxWords || !wordInput.trim() || isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
          aria-label="단어 추가"
        >
          추가
        </button>
      </div>

      {/* 입력된 단어 목록 */}
      {targetWords.length > 0 && (
        <ul
          className="flex flex-wrap gap-2"
          aria-label="입력된 목표 단어 목록"
        >
          {targetWords.map((word) => (
            <li key={word}>
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                {word}
                <button
                  type="button"
                  onClick={() => onRemoveWord(word)}
                  disabled={isSubmitting}
                  className="ml-1 text-blue-400 hover:text-blue-700 transition-colors"
                  aria-label={`${word} 단어 제거`}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 제출 버튼 */}
      <button
        type="button"
        onClick={() => void onSubmit()}
        disabled={isSubmitting}
        className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
        aria-label={isSubmitting ? '저장 중' : '기억 저장하기'}
      >
        {isSubmitting ? 'AI 분석 중...' : '기억 저장하기'}
      </button>

      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className="text-sm text-gray-400 hover:text-gray-600 transition-colors text-center disabled:opacity-50"
      >
        취소
      </button>
    </div>
  );
}
