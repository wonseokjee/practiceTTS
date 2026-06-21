// useQuizSession.ts — 퀴즈 풀이 FSM 훅 테스트 (핵심)
//
// 검증 포인트 (Plan §3, §9-3):
//  - 로드: idle → 상세 로드 후 첫 문제 answering, sessionToken 생성
//  - 정답 제출: selectAndSubmit → feedback, isCorrect=true, 같은 sessionToken POST
//  - 오답 제출: isCorrect=false + correctAnswer 노출
//  - 진행: feedback → next → 다음 문제(currentIndex 증가)
//  - 완료: 마지막 문제 completed=true → result, bestScore/isNewBest 반영
//  - 세션 만료(410): submitAttempts throw → isSessionExpired=true + error
//  - retry(): 처음부터 + 새 sessionToken

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useQuizSession } from './useQuizSession.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';
import type {
  QuizSetDetail,
  SubmitAttemptsResult,
} from '../domain/Quiz.js';

const QUIZ_SET_ID = 'set-1';

/** 2문제짜리 상세 픽스처 (multiple_choice 2개) */
function makeDetail(): QuizSetDetail {
  return {
    quizSetId: QUIZ_SET_ID,
    memoryEntry: { photoUrl: '/photo.jpg', caregiverWishMessage: null },
    patientNotes: [{ category: 'activity', answerText: '산책' }],
    questions: [
      {
        id: 'q1',
        orderIndex: 0,
        type: 'multiple_choice',
        prompt: '어디 갔나요?',
        choices: ['공원', '집', '병원', '시장'],
        hintFirstChar: null,
        targetWord: null,
      },
      {
        id: 'q2',
        orderIndex: 1,
        type: 'yes_no',
        prompt: '날씨가 좋았나요?',
        choices: null,
        hintFirstChar: null,
        targetWord: null,
      },
    ],
  };
}

/** 고정 토큰을 순차적으로 발급하는 생성기 (호출 횟수 추적) */
function makeTokenGen() {
  let n = 0;
  return vi.fn(() => `token-${++n}`);
}

interface MockApiOverrides {
  getSet?: IQuizApi['getSet'];
  submitAttempts?: IQuizApi['submitAttempts'];
}

function makeMockApi(overrides?: MockApiOverrides): IQuizApi {
  return {
    listSets: vi.fn(),
    getBestScore: vi.fn(),
    getWishPractice: vi.fn(),
    submitQabResults: vi.fn(),
    getQabSummary: vi.fn(),
    getSet: overrides?.getSet ?? vi.fn(async () => makeDetail()),
    submitAttempts:
      overrides?.submitAttempts ??
      vi.fn(
        async (): Promise<SubmitAttemptsResult> => ({
          results: [
            { questionId: 'q1', isCorrect: true, correctAnswer: '공원' },
          ],
          sessionScore: 100,
          completed: false,
        }),
      ),
  };
}

describe('useQuizSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('로드', () => {
    it('마운트 시 상세를 로드하고 첫 문제 answering으로 진입한다', async () => {
      const generateSessionToken = makeTokenGen();
      const quizApi = makeMockApi();

      const { result } = renderHook(() =>
        useQuizSession(QUIZ_SET_ID, { quizApi, generateSessionToken }),
      );

      await waitFor(() => {
        expect(result.current[0].phase).toBe('answering');
      });

      const [state] = result.current;
      expect(quizApi.getSet).toHaveBeenCalledWith(QUIZ_SET_ID);
      expect(state.currentIndex).toBe(0);
      expect(state.total).toBe(2);
      expect(state.currentQuestion?.id).toBe('q1');
      expect(state.isSelectable).toBe(true);
      // 세션 토큰이 한 번 생성됐다.
      expect(generateSessionToken).toHaveBeenCalledTimes(1);
    });

    it('문제가 0개이면 error 단계로 전이한다', async () => {
      const detail = makeDetail();
      detail.questions = [];
      const quizApi = makeMockApi({ getSet: vi.fn(async () => detail) });

      const { result } = renderHook(() =>
        useQuizSession(QUIZ_SET_ID, {
          quizApi,
          generateSessionToken: makeTokenGen(),
        }),
      );

      await waitFor(() => {
        expect(result.current[0].phase).toBe('error');
      });
      expect(result.current[0].error).toBe('문제가 아직 준비되지 않았어요.');
    });
  });

  describe('정답 제출', () => {
    it('정답이면 feedback 단계 + isCorrect=true이고 같은 sessionToken으로 POST한다', async () => {
      const generateSessionToken = makeTokenGen();
      const submitAttempts = vi.fn(
        async (): Promise<SubmitAttemptsResult> => ({
          results: [
            { questionId: 'q1', isCorrect: true, correctAnswer: '공원' },
          ],
          sessionScore: 100,
          completed: false,
        }),
      );
      const quizApi = makeMockApi({ submitAttempts });

      const { result } = renderHook(() =>
        useQuizSession(QUIZ_SET_ID, { quizApi, generateSessionToken }),
      );
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      await act(async () => {
        await result.current[1].selectAndSubmit('공원');
      });

      const [state] = result.current;
      expect(state.phase).toBe('feedback');
      expect(state.lastResult?.isCorrect).toBe(true);
      expect(state.sessionScore).toBe(100);
      expect(state.isSelectable).toBe(false);

      // POST 본문 검증: answers 1개 + 생성된 sessionToken.
      expect(submitAttempts).toHaveBeenCalledTimes(1);
      expect(submitAttempts).toHaveBeenCalledWith(QUIZ_SET_ID, {
        sessionToken: 'token-1',
        answers: [{ questionId: 'q1', userAnswer: '공원' }],
      });
    });
  });

  describe('오답 제출', () => {
    it('오답이면 isCorrect=false이고 correctAnswer를 노출한다', async () => {
      const submitAttempts = vi.fn(
        async (): Promise<SubmitAttemptsResult> => ({
          results: [
            { questionId: 'q1', isCorrect: false, correctAnswer: '공원' },
          ],
          sessionScore: 0,
          completed: false,
        }),
      );
      const quizApi = makeMockApi({ submitAttempts });

      const { result } = renderHook(() =>
        useQuizSession(QUIZ_SET_ID, {
          quizApi,
          generateSessionToken: makeTokenGen(),
        }),
      );
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      await act(async () => {
        await result.current[1].selectAndSubmit('집');
      });

      const [state] = result.current;
      expect(state.phase).toBe('feedback');
      expect(state.lastResult?.isCorrect).toBe(false);
      expect(state.lastResult?.correctAnswer).toBe('공원');
    });
  });

  describe('진행 및 완료', () => {
    it('next()로 다음 문제로 넘어가면 currentIndex가 증가한다', async () => {
      const quizApi = makeMockApi();

      const { result } = renderHook(() =>
        useQuizSession(QUIZ_SET_ID, {
          quizApi,
          generateSessionToken: makeTokenGen(),
        }),
      );
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      await act(async () => {
        await result.current[1].selectAndSubmit('공원');
      });
      expect(result.current[0].phase).toBe('feedback');

      act(() => {
        result.current[1].next();
      });

      const [state] = result.current;
      expect(state.phase).toBe('answering');
      expect(state.currentIndex).toBe(1);
      expect(state.currentQuestion?.id).toBe('q2');
      expect(state.lastResult).toBeNull();
    });

    it('마지막 문제에서 completed=true이면 next()가 result로 전이하고 bestScore/isNewBest를 반영한다', async () => {
      // 첫 제출은 미완료, 두 번째(마지막) 제출에서 completed=true.
      const submitAttempts = vi
        .fn<IQuizApi['submitAttempts']>()
        .mockResolvedValueOnce({
          results: [
            { questionId: 'q1', isCorrect: true, correctAnswer: '공원' },
          ],
          sessionScore: 50,
          completed: false,
        })
        .mockResolvedValueOnce({
          results: [{ questionId: 'q2', isCorrect: true, correctAnswer: 'yes' }],
          sessionScore: 100,
          completed: true,
          bestScore: 100,
          isNewBest: true,
        });
      const quizApi = makeMockApi({ submitAttempts });

      const { result } = renderHook(() =>
        useQuizSession(QUIZ_SET_ID, {
          quizApi,
          generateSessionToken: makeTokenGen(),
        }),
      );
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      // 1번 문제 풀고 다음으로.
      await act(async () => {
        await result.current[1].selectAndSubmit('공원');
      });
      act(() => result.current[1].next());
      expect(result.current[0].currentIndex).toBe(1);

      // 마지막(2번) 문제 풀이.
      await act(async () => {
        await result.current[1].selectAndSubmit('yes');
      });
      expect(result.current[0].phase).toBe('feedback');
      expect(result.current[0].completed).toBe(true);

      // next() → result.
      act(() => result.current[1].next());

      const [state] = result.current;
      expect(state.phase).toBe('result');
      expect(state.sessionScore).toBe(100);
      expect(state.bestScore).toBe(100);
      expect(state.isNewBest).toBe(true);
    });
  });

  describe('세션 만료(410)', () => {
    it('submitAttempts가 410을 던지면 isSessionExpired=true + error로 전이한다', async () => {
      const submitAttempts = vi.fn(async () => {
        throw { response: { status: 410 } };
      });
      const quizApi = makeMockApi({ submitAttempts });

      const { result } = renderHook(() =>
        useQuizSession(QUIZ_SET_ID, {
          quizApi,
          generateSessionToken: makeTokenGen(),
        }),
      );
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      await act(async () => {
        await result.current[1].selectAndSubmit('공원');
      });

      const [state] = result.current;
      expect(state.phase).toBe('error');
      expect(state.isSessionExpired).toBe(true);
      expect(state.error).toBe('시간이 초과됐어요. 다시 시작할까요?');
    });
  });

  describe('retry', () => {
    it('retry()는 처음부터 다시 로드하고 새 sessionToken을 발급한다', async () => {
      const generateSessionToken = makeTokenGen();
      const quizApi = makeMockApi();

      const { result } = renderHook(() =>
        useQuizSession(QUIZ_SET_ID, { quizApi, generateSessionToken }),
      );
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      // 1번 문제 풀고 진행.
      await act(async () => {
        await result.current[1].selectAndSubmit('공원');
      });
      act(() => result.current[1].next());
      expect(result.current[0].currentIndex).toBe(1);

      // retry → 처음부터.
      await act(async () => {
        await result.current[1].retry();
      });

      const [state] = result.current;
      expect(state.phase).toBe('answering');
      expect(state.currentIndex).toBe(0);
      expect(state.currentQuestion?.id).toBe('q1');
      // 마운트 1회 + retry 1회 = 2회 생성, 두 번째는 새 토큰.
      expect(generateSessionToken).toHaveBeenCalledTimes(2);
    });
  });
});
