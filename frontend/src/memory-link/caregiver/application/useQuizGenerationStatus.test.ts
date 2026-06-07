// useQuizGenerationStatus 폴링 훅 단위 테스트 (S1)
//
// 검증 포인트:
//  - enabled=false → 'idle', api 미호출
//  - ready 응답 → 'ready'
//  - failed 응답 → 'failed' + error 메시지
//  - 계속 pending → maxAttempts 초과 시 'timeout'
//  - retry() → regenerate 호출 후 재폴링하여 'ready'

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useQuizGenerationStatus } from './useQuizGenerationStatus.js';
import type {
  IQuizGenerationApi,
  QuizGenerationState,
} from '../infrastructure/QuizGenerationApi.js';

const ENTRY_ID = 'mem-uuid-1';

function makeApi(overrides?: Partial<IQuizGenerationApi>): IQuizGenerationApi {
  return {
    fetchLatestByMemoryEntry: vi.fn(async () => null),
    regenerate: vi.fn(async () => undefined),
    ...overrides,
  };
}

const FAST_DEPS = { intervalMs: 5, maxAttempts: 3 };

describe('useQuizGenerationStatus', () => {
  it('enabled=false면 idle을 유지하고 API를 호출하지 않는다', () => {
    const api = makeApi();
    const { result } = renderHook(() =>
      useQuizGenerationStatus(ENTRY_ID, false, { api, ...FAST_DEPS }),
    );

    expect(result.current.status).toBe('idle');
    expect(api.fetchLatestByMemoryEntry).not.toHaveBeenCalled();
  });

  it('ready 응답이면 status가 ready가 된다', async () => {
    const ready: QuizGenerationState = {
      quizSetId: 'set-1',
      generationStatus: 'ready',
      generationError: null,
    };
    const api = makeApi({ fetchLatestByMemoryEntry: vi.fn(async () => ready) });

    const { result } = renderHook(() =>
      useQuizGenerationStatus(ENTRY_ID, true, { api, ...FAST_DEPS }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('failed 응답이면 status=failed이고 error 메시지를 노출한다', async () => {
    const failed: QuizGenerationState = {
      quizSetId: 'set-1',
      generationStatus: 'failed',
      generationError: '메모 내용이 너무 짧아요.',
    };
    const api = makeApi({ fetchLatestByMemoryEntry: vi.fn(async () => failed) });

    const { result } = renderHook(() =>
      useQuizGenerationStatus(ENTRY_ID, true, { api, ...FAST_DEPS }),
    );

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.error).toBe('메모 내용이 너무 짧아요.');
  });

  it('계속 pending이면 maxAttempts 초과 후 timeout이 된다', async () => {
    const pending: QuizGenerationState = {
      quizSetId: 'set-1',
      generationStatus: 'pending',
      generationError: null,
    };
    const api = makeApi({
      fetchLatestByMemoryEntry: vi.fn(async () => pending),
    });

    const { result } = renderHook(() =>
      useQuizGenerationStatus(ENTRY_ID, true, { api, ...FAST_DEPS }),
    );

    await waitFor(() => expect(result.current.status).toBe('timeout'), {
      timeout: 2000,
    });
    expect(api.fetchLatestByMemoryEntry).toHaveBeenCalledTimes(3); // maxAttempts
  });

  it('retry()는 regenerate 호출 후 재폴링하여 ready로 복구한다', async () => {
    // 처음엔 failed, retry 이후엔 ready를 반환하도록 전환
    let phase: 'failed' | 'ready' = 'failed';
    const api = makeApi({
      fetchLatestByMemoryEntry: vi.fn(async () => ({
        quizSetId: 'set-1',
        generationStatus: phase,
        generationError: phase === 'failed' ? '일시 오류' : null,
      })),
      regenerate: vi.fn(async () => {
        phase = 'ready';
      }),
    });

    const { result } = renderHook(() =>
      useQuizGenerationStatus(ENTRY_ID, true, { api, ...FAST_DEPS }),
    );

    await waitFor(() => expect(result.current.status).toBe('failed'));

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.regenerate).toHaveBeenCalledWith(ENTRY_ID);
  });
});
