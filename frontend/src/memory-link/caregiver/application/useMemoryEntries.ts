import { useCallback, useEffect, useState } from 'react';
import type { MemoryEntry } from '../domain/MemoryEntry.js';
import { memoryEntryApi } from '../infrastructure/MemoryEntryApi.js';
import { extractErrorMessage } from '../../shared/extractErrorMessage.js';
import { dailyLimitMessage } from '../../shared/dailyLimit.js';

/** 시나리오 트리거 상태 */
export type ScenarioStatus = 'idle' | 'pending' | 'done' | 'error';

export interface UseMemoryEntriesReturn {
  entries: MemoryEntry[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  triggerScenario: (id: string) => Promise<void>;
  /** 엔트리 ID별 시나리오 트리거 상태 */
  scenarioStatus: Record<string, ScenarioStatus>;
  /**
   * 엔트리 ID별 실패 안내. 일일 생성 상한(429)일 때만 서버 문구가 들어간다 —
   * 그 외 실패는 화면의 기본 문구("다시 시도해주세요")가 맞다.
   */
  scenarioNotice: Record<string, string>;
}

/**
 * 메모리 엔트리 목록 조회 및 시나리오 트리거 훅
 * - 마운트 시 자동으로 목록 조회
 * - triggerScenario: 특정 엔트리의 시나리오 생성 트리거
 */
export function useMemoryEntries(): UseMemoryEntriesReturn {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [scenarioStatus, setScenarioStatus] = useState<
    Record<string, ScenarioStatus>
  >({});
  const [scenarioNotice, setScenarioNotice] = useState<Record<string, string>>(
    {},
  );

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await memoryEntryApi.getAll();
      setEntries(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const triggerScenario = useCallback(
    async (id: string): Promise<void> => {
      setScenarioStatus((prev) => ({ ...prev, [id]: 'pending' }));
      setScenarioNotice((prev) => {
        const { [id]: _cleared, ...rest } = prev;
        return rest;
      });

      try {
        await memoryEntryApi.triggerScenario(id);

        // 시나리오 생성 성공 후 해당 엔트리 상태 업데이트
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === id ? { ...entry, hasScenario: true } : entry,
          ),
        );
        setScenarioStatus((prev) => ({ ...prev, [id]: 'done' }));
      } catch (err) {
        setScenarioStatus((prev) => ({ ...prev, [id]: 'error' }));
        // 오늘 상한이면 "다시 시도"가 소용없다 — 내일까지 같은 답이다.
        const limit = dailyLimitMessage(err);
        if (limit !== null) {
          setScenarioNotice((prev) => ({ ...prev, [id]: limit }));
        }
        // 에러는 UI에서 scenarioStatus로 처리하므로 전역 error 상태에 포함하지 않음
        console.error(`시나리오 생성 실패 (id: ${id}):`, extractErrorMessage(err));
      }
    },
    [],
  );

  return {
    entries,
    isLoading,
    error,
    refresh,
    triggerScenario,
    scenarioStatus,
    scenarioNotice,
  };
}

