// useMemoryEntries — 시나리오 실패 안내(일일 생성 상한)
//
// 상한(429)에 걸린 실패는 "다시 시도해주세요"가 틀린 안내다. 내일까지 몇 번을
// 눌러도 같은 답이라, 서버 문구를 엔트리별로 들고 있다가 상세 화면에 넘긴다.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { getAll, triggerScenario } = vi.hoisted(() => ({
  getAll: vi.fn(),
  triggerScenario: vi.fn(),
}));

vi.mock('../infrastructure/MemoryEntryApi.js', () => ({
  memoryEntryApi: { getAll, triggerScenario },
}));

import { useMemoryEntries } from './useMemoryEntries.js';

const LIMIT_MESSAGE = '오늘은 여기까지예요. 내일 다시 이어서 해요.';

describe('useMemoryEntries — 시나리오 안내', () => {
  beforeEach(() => {
    getAll.mockReset().mockResolvedValue([]);
    triggerScenario.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('일일 상한 429면 그 엔트리에 서버 안내를 단다', async () => {
    triggerScenario.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 429,
        data: { code: 'DAILY_GENERATION_LIMIT', message: LIMIT_MESSAGE },
      },
    });
    const { result } = renderHook(() => useMemoryEntries());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.triggerScenario('e1');
    });

    expect(result.current.scenarioStatus.e1).toBe('error');
    expect(result.current.scenarioNotice.e1).toBe(LIMIT_MESSAGE);
  });

  it('다른 실패는 안내를 달지 않는다 — 화면 기본 문구가 맞다', async () => {
    triggerScenario.mockRejectedValue({
      isAxiosError: true,
      response: { status: 502, data: {} },
    });
    const { result } = renderHook(() => useMemoryEntries());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.triggerScenario('e1');
    });

    expect(result.current.scenarioStatus.e1).toBe('error');
    expect(result.current.scenarioNotice.e1).toBeUndefined();
  });

  it('다시 누르면 지난 안내를 지운다', async () => {
    triggerScenario
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 429,
          data: { code: 'DAILY_GENERATION_LIMIT', message: LIMIT_MESSAGE },
        },
      })
      .mockResolvedValueOnce({ status: 'ok', memoryEntryId: 'e1' });
    const { result } = renderHook(() => useMemoryEntries());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.triggerScenario('e1');
    });
    await act(async () => {
      await result.current.triggerScenario('e1');
    });

    expect(result.current.scenarioStatus.e1).toBe('done');
    expect(result.current.scenarioNotice.e1).toBeUndefined();
  });
});
