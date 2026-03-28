import { useCallback, useEffect, useRef } from 'react';

/** 침묵 감지 훅 옵션 */
export interface UseSilenceDetectorProps {
  /** 침묵 감지 시 호출할 콜백 */
  onSilence: () => void;
  /** 침묵 감지 시간 (기본값: 10000ms = 10초) */
  timeoutMs?: number;
  /** false이면 타이머 동작 안 함 */
  isActive: boolean;
}

/**
 * 침묵 감지 훅
 * - isActive=true이면 타이머 시작
 * - resetTimer() 호출 시 타이머 리셋 (STT 결과 수신 시 호출)
 * - timeoutMs 경과 시 onSilence 콜백 호출
 * - isActive=false가 되면 타이머 즉시 취소
 */
export function useSilenceDetector({
  onSilence,
  timeoutMs = 10_000,
  isActive,
}: UseSilenceDetectorProps): { resetTimer: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 콜백을 ref로 유지하여 의존성 배열 재생성 방지
  const onSilenceRef = useRef(onSilence);

  // onSilence 콜백을 항상 최신 상태로 유지
  useEffect(() => {
    onSilenceRef.current = onSilence;
  }, [onSilence]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      onSilenceRef.current();
    }, timeoutMs);
  }, [clearTimer, timeoutMs]);

  /** 타이머를 리셋한다 (STT 결과 수신 시 호출) */
  const resetTimer = useCallback(() => {
    if (isActive) {
      startTimer();
    }
  }, [isActive, startTimer]);

  // isActive 변경에 따라 타이머 시작/취소
  useEffect(() => {
    if (isActive) {
      startTimer();
    } else {
      clearTimer();
    }

    return () => {
      clearTimer();
    };
  }, [isActive, startTimer, clearTimer]);

  return { resetTimer };
}
