// 말운동(DDK, 검사8) 문항 렌더러 (kind 'ddk')
//
// 한 음절(예: "퍼-터-커")을 최대한 빠르게 반복하도록 하고, 마이크로 녹음한 음량에서
// 음절 반복 횟수를 세어 targetCount 이상이면 통과(로컬 채점).
//  - 흐름: 음절 표시 → 🎙️ 시작 → (반복 발음) → ⏹️ 멈추기 → 횟수 분석 → 제출.
//  - 막히면 "넘어가기"로 보호자가 통과 처리(목표 횟수를 제출).
// 녹음기(IDdkRecorder)는 주입 가능하며 기본은 Web Audio 구현이다.

import { useEffect, useMemo, useState } from 'react';
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
  createRecorder,
}: DdkItemProps) {
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
      setErrorMessage('마이크를 시작할 수 없습니다. 권한을 확인해주세요.');
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
      setErrorMessage('녹음 분석에 실패했습니다. 다시 시도해주세요.');
      setStatus('error');
    }
  };

  const handleSubmit = (): void => {
    if (count === null) return;
    onSubmit(count);
  };

  // "넘어가기": 보호자가 했다고 보고 통과 처리(목표 횟수 제출 → 정답).
  const handleSkip = (): void => {
    if (!isSelectable) return;
    onSubmit(item.targetCount);
  };

  let resultBoxClass = 'border-[#D4D8D4] bg-white text-[#1F2A26]';
  if (showFeedback) {
    resultBoxClass =
      isCorrect === true
        ? 'border-[#2D6A56] bg-[#EBF4F0] text-[#1F5240]'
        : 'border-[#E07B54] bg-[#FBE9E2] text-[#7A2E15]';
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-[#5C6661]">{item.instruction}</p>

      {/* 반복할 음절 (크게) */}
      <div
        className="flex min-h-[112px] items-center justify-center rounded-md border-2 border-[#D4D8D4] bg-white px-5 py-6"
        aria-label={`반복할 소리: ${item.label}`}
      >
        <span className="text-5xl font-bold tracking-widest text-[#1F2A26]">
          {item.label}
        </span>
      </div>

      <p className="text-center text-sm text-[#5C6661]">
        {item.targetCount}회 이상 반복하면 통과예요.
      </p>

      {/* 분석 결과 (녹음 완료 또는 피드백 단계) */}
      {(showFeedback || status === 'recorded') && count !== null && (
        <div
          className={`flex min-h-[56px] items-center justify-between gap-3 rounded-md border-2 px-5 py-3 transition-colors duration-[180ms] ease-out ${resultBoxClass}`}
          aria-live="polite"
          aria-label={`감지된 반복: ${count}회`}
        >
          <span className="text-lg font-bold">{count}회 반복</span>
          {showFeedback && (
            <span className="text-2xl" aria-hidden="true">
              {isCorrect === true ? '✓' : '✗'}
            </span>
          )}
        </div>
      )}

      {!showFeedback && status === 'recording' && (
        <p className="text-base text-[#2D6A56]" role="status">
          녹음 중이에요… 끝나면 멈추기를 눌러주세요.
        </p>
      )}
      {!showFeedback && status === 'error' && errorMessage.length > 0 && (
        <p className="text-base text-[#7A2E15]" role="alert">
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
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-[#E07B54] bg-white px-6 py-4 text-xl font-medium text-[#7A2E15] transition-colors duration-[180ms] ease-out hover:bg-[#FBE9E2]"
              aria-label="멈추기"
            >
              <span aria-hidden="true" className="text-2xl">⏹️</span>
              멈추기
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={!isSelectable || status === 'analyzing'}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-[#2D6A56] bg-white px-6 py-4 text-xl font-medium text-[#2D6A56] transition-colors duration-[180ms] ease-out hover:bg-[#EBF4F0] disabled:cursor-not-allowed disabled:border-[#C5C8C5] disabled:text-[#A8AFA9]"
              aria-label={status === 'recorded' ? '다시 녹음' : '시작'}
            >
              <span aria-hidden="true" className="text-2xl">🎙️</span>
              {status === 'analyzing'
                ? '분석 중…'
                : status === 'recorded'
                  ? '다시 녹음'
                  : '시작'}
            </button>
          )}

          {status === 'recorded' && count !== null && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isSelectable}
              className="min-h-[56px] rounded-md bg-[#2D6A56] px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240] disabled:cursor-not-allowed disabled:bg-[#C5C8C5] disabled:text-[#7A7E7A]"
              aria-label="제출"
            >
              제출
            </button>
          )}

          <button
            type="button"
            onClick={handleSkip}
            disabled={!isSelectable}
            className="min-h-[48px] rounded-md bg-white px-5 py-3 text-base font-medium text-[#5C6661] ring-1 ring-inset ring-[#D4D8D4] transition-colors duration-[180ms] ease-out hover:bg-[#EBEAE6] disabled:cursor-not-allowed disabled:text-[#C5C8C5]"
            aria-label="넘어가기"
          >
            넘어가기
          </button>
        </div>
      )}
    </div>
  );
}
