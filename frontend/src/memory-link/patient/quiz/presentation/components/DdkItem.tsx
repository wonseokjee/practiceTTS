// 말운동(DDK, 검사8) 문항 렌더러 (kind 'ddk')
//
// 한 음절(예: "퍼-터-커")을 최대한 빠르게 반복하도록 하고, 마이크로 녹음한 음량에서
// 음절 반복 횟수를 세어 targetCount 이상이면 통과(로컬 채점).
//  - 흐름: 음절 표시 → 🎙️ 시작 → (반복 발음) → ⏹️ 멈추기 → 횟수 분석 → 제출.
//  - 막히면 "넘어가기"로 보호자가 통과 처리(목표 횟수를 제출).
// 녹음기(IDdkRecorder)는 주입 가능하며 기본은 Web Audio 구현이다.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IDdkRecorder } from '../../infrastructure/DdkRecorder.js';
import { WebAudioDdkRecorder } from '../../infrastructure/DdkRecorder.js';
import type { QabDdkItem } from '../../domain/MixedQuiz.js';

interface DdkItemProps {
  item: QabDdkItem;
  isSelectable: boolean;
  showFeedback: boolean;
  /** 채점 결과 — 피드백 단계에서만 의미 */
  isCorrect: boolean | null;
  /** 감지된 음절 수를 제출 */
  onSubmit: (count: number) => void;
  /** 보호자 통과 처리(도움받음). 없으면 목표 횟수 제출로 폴백. */
  onSkip?: () => void;
  /** 녹음기 팩토리 (테스트 주입용) */
  createRecorder?: () => IDdkRecorder;
}

type DdkStatus = 'idle' | 'recording' | 'analyzing' | 'recorded' | 'error';

/** 말운동(DDK) 문항 */
export function DdkItem({
  item,
  isSelectable,
  showFeedback,
  isCorrect,
  onSubmit,
  onSkip,
  createRecorder,
}: DdkItemProps) {
  const { t } = useTranslation('quiz');
  const [status, setStatus] = useState<DdkStatus>('idle');
  const [count, setCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const recorder = useMemo<IDdkRecorder>(
    () => (createRecorder ?? (() => new WebAudioDdkRecorder()))(),
    [createRecorder],
  );

  // 언마운트 시 녹음기 정리 — 마이크/오디오컨텍스트가 켜진 채로 남지 않게 한다.
  // (녹음 중 "그만두기"로 화면을 떠나도 마이크 표시등이 계속 켜지는 것을 방지.)
  // stop()은 시작 전 호출에도 안전하다(스트림 null 가드 + countSyllables([])=0).
  useEffect(() => {
    return () => {
      void recorder.stop().catch(() => {});
    };
  }, [recorder]);

  const handleStart = async (): Promise<void> => {
    if (!isSelectable) return;
    setErrorMessage('');
    try {
      await recorder.start();
      setStatus('recording');
    } catch {
      setErrorMessage(t('ddk.micError'));
      setStatus('error');
    }
  };

  const handleStop = async (): Promise<void> => {
    setStatus('analyzing');
    try {
      const result = await recorder.stop();
      setCount(result.count);
      setStatus('recorded');
    } catch {
      setErrorMessage(t('ddk.analysisError'));
      setStatus('error');
    }
  };

  const handleSubmit = (): void => {
    if (count === null) return;
    onSubmit(count);
  };

  // "넘어가기": 보호자가 했다고 보고 통과 처리(도움받음).
  const handleSkip = (): void => {
    if (!isSelectable) return;
    if (onSkip) {
      onSkip();
      return;
    }
    onSubmit(item.targetCount);
  };

  let resultBoxClass = 'border-line-strong bg-white text-ink-sage';
  if (showFeedback) {
    resultBoxClass =
      isCorrect === true
        ? 'border-primary bg-primary-light text-primary-dark'
        : 'border-accent bg-accent-soft text-accent-ink';
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted-sage">{item.instruction}</p>

      {/* 반복할 음절 (크게) */}
      <div
        className="flex min-h-[112px] items-center justify-center rounded-md border-2 border-line-strong bg-white px-5 py-6"
        aria-label={t('ddk.soundAria', { label: item.label })}
      >
        <span className="text-5xl font-bold tracking-widest text-ink-sage">
          {item.label}
        </span>
      </div>

      <p className="text-center text-sm text-muted-sage">
        {t('ddk.passTarget', { count: item.targetCount })}
      </p>

      {/* 분석 결과 (녹음 완료 또는 피드백 단계) */}
      {(showFeedback || status === 'recorded') && count !== null && (
        <div
          className={`flex min-h-[56px] items-center justify-between gap-3 rounded-md border-2 px-5 py-3 transition-colors duration-[180ms] ease-out ${resultBoxClass}`}
          aria-live="polite"
          aria-label={t('ddk.detectedAria', { count })}
        >
          <span className="text-lg font-bold">{t('ddk.detected', { count })}</span>
          {showFeedback && (
            <span className="text-2xl" aria-hidden="true">
              {isCorrect === true ? '✓' : '✗'}
            </span>
          )}
        </div>
      )}

      {!showFeedback && status === 'recording' && (
        <p className="text-base text-primary" role="status">
          {t('ddk.recording')}
        </p>
      )}
      {!showFeedback && status === 'error' && errorMessage.length > 0 && (
        <p className="text-base text-accent-ink" role="alert">
          {errorMessage}
        </p>
      )}

      {/* 컨트롤 (피드백 단계에선 숨김) */}
      {!showFeedback && (
        <div className="flex flex-col gap-3">
          {status === 'recording' ? (
            <button
              type="button"
              onClick={() => void handleStop()}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-accent-strong bg-white px-6 py-4 text-xl font-medium text-accent-ink transition-colors duration-[180ms] ease-out hover:bg-accent-soft"
              aria-label={t('ddk.stop')}
            >
              <span aria-hidden="true" className="text-2xl">⏹️</span>
              {t('ddk.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={!isSelectable || status === 'analyzing'}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-primary bg-white px-6 py-4 text-xl font-medium text-primary transition-colors duration-[180ms] ease-out hover:bg-primary-light disabled:cursor-not-allowed disabled:border-disabled-surface disabled:text-muted-faint"
              aria-label={status === 'recorded' ? t('ddk.recordAgain') : t('ddk.start')}
            >
              <span aria-hidden="true" className="text-2xl">🎙️</span>
              {status === 'analyzing'
                ? t('ddk.analyzing')
                : status === 'recorded'
                  ? t('ddk.recordAgain')
                  : t('ddk.start')}
            </button>
          )}

          {status === 'recorded' && count !== null && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isSelectable}
              className="min-h-[56px] rounded-md bg-primary px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-disabled-surface disabled:text-disabled-ink"
              aria-label={t('item.submit')}
            >
              {t('item.submit')}
            </button>
          )}

          <button
            type="button"
            onClick={handleSkip}
            disabled={!isSelectable}
            className="min-h-[48px] rounded-md bg-white px-5 py-3 text-base font-medium text-muted-sage ring-1 ring-inset ring-line-strong transition-colors duration-[180ms] ease-out hover:bg-canvas-hover disabled:cursor-not-allowed disabled:text-disabled-surface"
            aria-label={t('item.skip')}
          >
            {t('item.skip')}
          </button>
        </div>
      )}
    </div>
  );
}
