// useQuizList.ts — 풀 수 있는 퀴즈 목록 조회 훅 테스트
//
// 검증 포인트:
//  - 마운트 시 listSets({status:'ready', limit:20}) 호출 → items 로드
//  - 로딩 종료 후 isLoading=false
//  - 에러 시 error 메시지 설정
//  - reload()로 재조회

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useQuizList } from './useQuizList.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';
import type { QuizSetSummary } from '../domain/Quiz.js';

const SUMMARY: QuizSetSummary = {
  quizSetId: 'set-1',
  memoryEntryId: 'entry-1',
  photoUrl: null,
  generationStatus: 'ready',
  bestScore: null,
  createdAt: '2026-06-01T09:00:00Z',
};

function makeMockApi(listSets: IQuizApi['listSets']): IQuizApi {
  return {
    listSets,
    getSet: vi.fn(),
    submitAttempts: vi.fn(),
    getBestScore: vi.fn(),
    getWishPractice: vi.fn(),
    submitQabResults: vi.fn(),
    getQabSummary: vi.fn(),
  getQabTrend: vi.fn(),
  getSkillLevels: vi.fn(),
  getActivityDays: vi.fn(),
  getSessionStats: vi.fn(),
  };
}

describe('useQuizList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('마운트 시 ready/limit 20으로 조회하고 items를 로드한다', async () => {
    const listSets = vi.fn(async () => [SUMMARY]);
    const quizApi = makeMockApi(listSets);

    const { result } = renderHook(() => useQuizList({ quizApi }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listSets).toHaveBeenCalledWith({ status: 'ready', limit: 20 });
    expect(result.current.items).toEqual([SUMMARY]);
    expect(result.current.error).toBeNull();
  });

  it('초기에는 isLoading=true이다', async () => {
    const quizApi = makeMockApi(vi.fn(async () => []));
    const { result } = renderHook(() => useQuizList({ quizApi }));
    expect(result.current.isLoading).toBe(true);
    // 비동기 로드 완료를 기다려 act 경고/상태 누수를 방지한다.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('조회 실패 시 error 메시지를 설정한다', async () => {
    const listSets = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const quizApi = makeMockApi(listSets);

    const { result } = renderHook(() => useQuizList({ quizApi }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('퀴즈를 찾을 수 없어요.');
    expect(result.current.items).toEqual([]);
  });

  it('reload()로 목록을 다시 불러온다', async () => {
    const listSets = vi
      .fn<IQuizApi['listSets']>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([SUMMARY]);
    const quizApi = makeMockApi(listSets);

    const { result } = renderHook(() => useQuizList({ quizApi }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);

    await act(async () => {
      await result.current.reload();
    });

    expect(listSets).toHaveBeenCalledTimes(2);
    expect(result.current.items).toEqual([SUMMARY]);
  });
});
