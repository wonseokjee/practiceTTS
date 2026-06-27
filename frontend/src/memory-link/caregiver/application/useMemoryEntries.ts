import { useCallback, useEffect, useState } from 'react';
import type { MemoryEntry } from '../domain/MemoryEntry.js';
import { memoryEntryApi } from '../infrastructure/MemoryEntryApi.js';
import { extractErrorMessage } from '../../shared/extractErrorMessage.js';

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
        // 에러는 UI에서 scenarioStatus로 처리하므로 전역 error 상태에 포함하지 않음
        console.error(`시나리오 생성 실패 (id: ${id}):`, extractErrorMessage(err));
      }
    },
    [],
  );

  return { entries, isLoading, error, refresh, triggerScenario, scenarioStatus };
}

