// 퀴즈 자동생성 결과 폴링 훅 (S1)
//
// 라이프로그 저장 후 보호자에게 생성 결과(ready/failed)를 보여주기 위해
// GET /quiz/sets?memoryEntryId를 주기적으로 조회한다.
//
// 상태 전이:
//   enabled=false        → 'idle' (퀴즈 미기대: 노트 없이 사진만 저장한 경우)
//   enabled=true 시작    → 'pending' (폴링 중)
//     ├ ready            → 'ready'   (정지)
//     ├ failed           → 'failed'  (정지, error 표시 + 재시도 가능)
//     └ maxAttempts 초과 → 'timeout' (정지, "조금 더 걸려요" 안내)
//   retry()              → regenerate 호출 후 'pending'으로 복귀하여 재폴링

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  IQuizGenerationApi,
  QuizGenerationState,
} from '../infrastructure/QuizGenerationApi.js';
import { quizGenerationApi } from '../infrastructure/QuizGenerationApi.js';
import { dailyLimitMessage } from '../../shared/dailyLimit.js';

export type GenerationPollStatus =
  | 'idle'
  | 'pending'
  | 'ready'
  | 'failed'
  | 'timeout';

export interface UseQuizGenerationStatusReturn {
  status: GenerationPollStatus;
  /** failed일 때 사유 메시지 */
  error: string | null;
  /** 재생성 트리거 후 재폴링 (failed/timeout 복구용) */
  retry: () => void;
}

export interface UseQuizGenerationStatusDeps {
  api?: IQuizGenerationApi;
  /** 폴링 간격(ms). 기본 2000 */
  intervalMs?: number;
  /** 최대 시도 횟수. 기본 15 (≈30초) */
  maxAttempts?: number;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_ATTEMPTS = 15;

/**
 * @param memoryEntryId 폴링 대상 라이프로그 ID (null이면 비활성)
 * @param enabled       퀴즈 생성이 기대되는 경우에만 true (노트 ≥ 1)
 */
export function useQuizGenerationStatus(
  memoryEntryId: string | null,
  enabled: boolean,
  deps?: UseQuizGenerationStatusDeps,
): UseQuizGenerationStatusReturn {
  const apiRef = useRef<IQuizGenerationApi>(deps?.api ?? quizGenerationApi);
  const intervalMs = deps?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxAttempts = deps?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const [status, setStatus] = useState<GenerationPollStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // 진행 중인 폴링 루프를 식별/취소하기 위한 토큰. retry/unmount 시 증가시켜
  // 이전 루프가 더 이상 상태를 갱신하지 못하게 한다.
  const runIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (entryId: string) => {
      clearTimer();
      const myRunId = ++runIdRef.current;
      let attempts = 0;
      setStatus('pending');
      setError(null);

      const tick = async (): Promise<void> => {
        if (myRunId !== runIdRef.current) return; // 취소된 루프
        attempts += 1;

        let state: QuizGenerationState | null = null;
        try {
          state = await apiRef.current.fetchLatestByMemoryEntry(entryId);
        } catch {
          // 일시적 조회 실패는 다음 시도로 흡수 (네트워크 흔들림 등)
        }
        if (myRunId !== runIdRef.current) return;

        if (state?.generationStatus === 'ready') {
          setStatus('ready');
          return;
        }
        if (state?.generationStatus === 'failed') {
          setError(state.generationError);
          setStatus('failed');
          return;
        }

        // null(아직 set 없음) 또는 pending → 재시도
        if (attempts >= maxAttempts) {
          setStatus('timeout');
          return;
        }
        timerRef.current = setTimeout(() => void tick(), intervalMs);
      };

      void tick();
    },
    [clearTimer, intervalMs, maxAttempts],
  );

  // enabled + memoryEntryId가 준비되면 폴링 시작.
  useEffect(() => {
    if (!enabled || !memoryEntryId) {
      runIdRef.current += 1; // 진행 중 루프 취소
      clearTimer();
      setStatus('idle');
      setError(null);
      return;
    }
    startPolling(memoryEntryId);
    return () => {
      runIdRef.current += 1;
      clearTimer();
    };
  }, [enabled, memoryEntryId, startPolling, clearTimer]);

  const retry = useCallback((): void => {
    if (!memoryEntryId) return;
    setStatus('pending');
    setError(null);
    void apiRef.current
      .regenerate(memoryEntryId)
      .then(() => startPolling(memoryEntryId))
      .catch((err: unknown) => {
        // 오늘 상한(429)이면 "잠시 후 다시"가 틀린 안내다 — 서버 문구를 쓴다.
        setError(
          dailyLimitMessage(err) ??
            '재시도 요청에 실패했어요. 잠시 후 다시 시도해주세요.',
        );
        setStatus('failed');
      });
  }, [memoryEntryId, startPolling]);

  return { status, error, retry };
}
