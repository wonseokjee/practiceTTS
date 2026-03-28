/**
 * performance.now() 기반 카운트다운 타이머 훅
 *
 * AWAITING_TOUCH 상태에서 10초 타임아웃을 시각적으로 표시하기 위해 사용.
 * requestAnimationFrame으로 UI를 부드럽게 업데이트한다.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseTimerReturn {
  /** 남은 시간 (초, 0 이상) */
  remainingSeconds: number;
  /** 타이머 시작. durationMs: 총 카운트다운 시간(ms) */
  start: (durationMs: number) => void;
  /** 타이머 중지 */
  stop: () => void;
  /** 타이머 초기화 (remainingSeconds를 0으로 리셋) */
  reset: () => void;
}

export function useTimer(): UseTimerReturn {
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const rafIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const durationMsRef = useRef<number>(0);

  const stop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stop();
    startTimeRef.current = null;
    durationMsRef.current = 0;
    setRemainingSeconds(0);
  }, [stop]);

  const start = useCallback(
    (durationMs: number) => {
      // 기존 타이머 중지
      stop();

      durationMsRef.current = durationMs;
      startTimeRef.current = performance.now();

      const tick = () => {
        const elapsed = performance.now() - (startTimeRef.current ?? 0);
        const remaining = Math.max(0, durationMs - elapsed);
        const remainingSecs = Math.ceil(remaining / 1000);

        setRemainingSeconds(remainingSecs);

        if (remaining > 0) {
          rafIdRef.current = requestAnimationFrame(tick);
        } else {
          rafIdRef.current = null;
        }
      };

      rafIdRef.current = requestAnimationFrame(tick);
    },
    [stop],
  );

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return { remainingSeconds, start, stop, reset };
}
