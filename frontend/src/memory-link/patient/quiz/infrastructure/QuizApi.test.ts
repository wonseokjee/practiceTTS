// QuizApi.ts — API 클라이언트 호출/타입가드 테스트
//
// 검증 포인트:
//  - 각 메서드가 올바른 URL/쿼리/바디로 memoryLinkApi를 호출
//  - 정상 응답은 통과, 형식 이상 응답은 INVALID_RESPONSE_MESSAGE로 거부

import { describe, expect, it, vi, beforeEach } from 'vitest';

// memoryLinkApi 모킹 (네트워크 불필요)
const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../../../shared/MemoryLinkApi.js', () => ({
  memoryLinkApi: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
  ML_TOKEN_KEY: 'ml_token',
  ML_PATIENT_MODE_KEY: 'ml_patient_mode',
}));

import { quizApi } from './QuizApi.js';
import type { QuizSetSummary } from '../domain/Quiz.js';

const VALID_SUMMARY: QuizSetSummary = {
  quizSetId: 'set-1',
  memoryEntryId: 'entry-1',
  photoUrl: null,
  generationStatus: 'ready',
  bestScore: 80,
  createdAt: '2026-06-01T09:00:00Z',
};

describe('quizApi', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  describe('listSets', () => {
    it('status/limit 쿼리로 GET /quiz/sets를 호출하고 items 배열을 반환한다', async () => {
      getMock.mockResolvedValue({ data: { items: [VALID_SUMMARY] } });

      const result = await quizApi.listSets({ status: 'ready', limit: 20 });

      expect(getMock).toHaveBeenCalledWith('/quiz/sets', {
        params: { status: 'ready', limit: 20, memoryEntryId: undefined },
      });
      expect(result).toEqual([VALID_SUMMARY]);
    });

    it('items가 배열이 아니면 형식 오류를 던진다', async () => {
      getMock.mockResolvedValue({ data: { items: 'not-an-array' } });
      await expect(quizApi.listSets()).rejects.toThrow(
        '서버 응답 형식이 올바르지 않습니다.',
      );
    });

    it('항목 타입가드를 통과하지 못하면 형식 오류를 던진다', async () => {
      getMock.mockResolvedValue({
        data: { items: [{ quizSetId: 123 }] },
      });
      await expect(quizApi.listSets()).rejects.toThrow(
        '서버 응답 형식이 올바르지 않습니다.',
      );
    });
  });

  describe('getSet', () => {
    it('GET /quiz/sets/:id를 호출하고 상세를 반환한다', async () => {
      const detail = {
        quizSetId: 'set-1',
        memoryEntry: { photoUrl: '/p.jpg', caregiverWishMessage: null },
        patientNotes: [{ category: 'activity', answerText: '산책' }],
        questions: [
          {
            id: 'q1',
            orderIndex: 0,
            type: 'multiple_choice',
            prompt: '어디 갔나요?',
            choices: ['공원', '집', '병원', '시장'],
            hintFirstChar: null,
          },
        ],
      };
      getMock.mockResolvedValue({ data: detail });

      const result = await quizApi.getSet('set-1');

      expect(getMock).toHaveBeenCalledWith('/quiz/sets/set-1');
      expect(result).toEqual(detail);
    });

    it('상세 형식이 올바르지 않으면 오류를 던진다', async () => {
      getMock.mockResolvedValue({ data: { quizSetId: 'set-1' } });
      await expect(quizApi.getSet('set-1')).rejects.toThrow(
        '서버 응답 형식이 올바르지 않습니다.',
      );
    });
  });

  describe('submitAttempts', () => {
    it('POST /quiz/sets/:id/attempts를 sessionToken/answers 바디로 호출한다', async () => {
      const apiResult = {
        results: [{ questionId: 'q1', isCorrect: true, correctAnswer: '공원' }],
        sessionScore: 100,
        completed: false,
      };
      postMock.mockResolvedValue({ data: apiResult });

      const request = {
        sessionToken: 'token-abc',
        answers: [{ questionId: 'q1', userAnswer: '공원' }],
      };
      const result = await quizApi.submitAttempts('set-1', request);

      expect(postMock).toHaveBeenCalledWith(
        '/quiz/sets/set-1/attempts',
        request,
      );
      expect(result).toEqual(apiResult);
    });

    it('응답 형식이 올바르지 않으면 오류를 던진다', async () => {
      postMock.mockResolvedValue({ data: { results: 'nope' } });
      await expect(
        quizApi.submitAttempts('set-1', {
          sessionToken: 't',
          answers: [],
        }),
      ).rejects.toThrow('서버 응답 형식이 올바르지 않습니다.');
    });
  });

  describe('getBestScore', () => {
    it('GET /quiz/sets/:id/best-score를 호출하고 결과를 반환한다', async () => {
      const best = { quizSetId: 'set-1', bestScore: 90 };
      getMock.mockResolvedValue({ data: best });

      const result = await quizApi.getBestScore('set-1');

      expect(getMock).toHaveBeenCalledWith('/quiz/sets/set-1/best-score');
      expect(result).toEqual(best);
    });
  });

  describe('submitQabResults', () => {
    it('POST /quiz/qab-results를 sessionToken/results 바디로 호출한다', async () => {
      postMock.mockResolvedValue({ data: { saved: 2 } });
      const results = [
        { subtest: 'word' as const, itemRef: 'qw_001', isCorrect: true },
        { subtest: 'ddk' as const, itemRef: 'ddk_0', isCorrect: true, metric: 11 },
      ];

      const res = await quizApi.submitQabResults('tok-1', results);

      expect(postMock).toHaveBeenCalledWith('/quiz/qab-results', {
        sessionToken: 'tok-1',
        results,
      });
      expect(res).toEqual({ saved: 2 });
    });

    it('saved가 숫자가 아니면 형식 오류를 던진다', async () => {
      postMock.mockResolvedValue({ data: { ok: true } });
      await expect(quizApi.submitQabResults('tok-1', [])).rejects.toThrow(
        '서버 응답 형식이 올바르지 않습니다.',
      );
    });

    it('manifestVersion을 주면 바디에 포함하고, 안 주면 생략한다', async () => {
      postMock.mockResolvedValue({ data: { saved: 1 } });
      const results = [
        {
          subtest: 'word' as const,
          itemRef: 'qw_001',
          isCorrect: true,
          presentedLevel: 3,
        },
      ];

      await quizApi.submitQabResults('tok-1', results, 1);
      expect(postMock).toHaveBeenCalledWith('/quiz/qab-results', {
        sessionToken: 'tok-1',
        results,
        manifestVersion: 1,
      });

      postMock.mockClear();
      await quizApi.submitQabResults('tok-2', results);
      expect(postMock).toHaveBeenCalledWith('/quiz/qab-results', {
        sessionToken: 'tok-2',
        results,
      });
    });

    it('completed=true면 바디에 포함하고, false/생략이면 생략한다', async () => {
      postMock.mockResolvedValue({ data: { saved: 1 } });
      const results = [
        { subtest: 'word' as const, itemRef: 'qw_001', isCorrect: true },
      ];

      await quizApi.submitQabResults('tok-1', results, undefined, true);
      expect(postMock).toHaveBeenCalledWith('/quiz/qab-results', {
        sessionToken: 'tok-1',
        results,
        completed: true,
      });

      postMock.mockClear();
      await quizApi.submitQabResults('tok-1', results, undefined, false);
      expect(postMock).toHaveBeenCalledWith('/quiz/qab-results', {
        sessionToken: 'tok-1',
        results,
      });
    });
  });

  describe('getSkillLevels', () => {
    it('GET /quiz/skill-levels를 호출하고 levels/manifestVersion을 반환한다', async () => {
      const data = {
        levels: { word: 3, sentence: 2, naming: 2, repeat: 2, reading: 2, ddk: 2, loc: 2 },
        manifestVersion: 1,
      };
      getMock.mockResolvedValue({ data });

      const res = await quizApi.getSkillLevels();

      expect(getMock).toHaveBeenCalledWith('/quiz/skill-levels');
      expect(res).toEqual(data);
    });

    it('레벨 값이 숫자가 아니면 형식 오류를 던진다', async () => {
      getMock.mockResolvedValue({
        data: { levels: { word: 'x' }, manifestVersion: 1 },
      });
      await expect(quizApi.getSkillLevels()).rejects.toThrow(
        '서버 응답 형식이 올바르지 않습니다.',
      );
    });

    it('manifestVersion이 없으면 형식 오류를 던진다', async () => {
      getMock.mockResolvedValue({ data: { levels: {} } });
      await expect(quizApi.getSkillLevels()).rejects.toThrow(
        '서버 응답 형식이 올바르지 않습니다.',
      );
    });
  });

  describe('getActivityDays', () => {
    it('GET /quiz/activity-days를 호출하고 날짜 배열을 반환한다', async () => {
      getMock.mockResolvedValue({ data: { days: ['2026-08-12', '2026-08-10'] } });

      const res = await quizApi.getActivityDays(14);

      expect(getMock).toHaveBeenCalledWith('/quiz/activity-days', {
        params: { days: 14 },
      });
      expect(res).toEqual(['2026-08-12', '2026-08-10']);
    });

    it('days 미지정이면 params 없이 호출한다', async () => {
      getMock.mockResolvedValue({ data: { days: [] } });
      await quizApi.getActivityDays();
      expect(getMock).toHaveBeenCalledWith('/quiz/activity-days', {
        params: undefined,
      });
    });

    it('days가 배열이 아니면 형식 오류를 던진다', async () => {
      getMock.mockResolvedValue({ data: { days: 'nope' } });
      await expect(quizApi.getActivityDays()).rejects.toThrow(
        '서버 응답 형식이 올바르지 않습니다.',
      );
    });
  });

  describe('getQabSummary', () => {
    it('GET /quiz/qab-summary를 호출하고 items 배열을 반환한다', async () => {
      const item = {
        subtest: 'word',
        total: 4,
        correct: 3,
        accuracy: 75,
        assisted: 1,
        avgMetric: null,
        maxMetric: null,
        avgScore: null,
        lastAt: '2026-06-20T00:00:00.000Z',
      };
      getMock.mockResolvedValue({ data: { items: [item] } });

      const res = await quizApi.getQabSummary();

      expect(getMock).toHaveBeenCalledWith('/quiz/qab-summary');
      expect(res).toEqual([item]);
    });

    it('항목 타입가드를 통과하지 못하면 형식 오류를 던진다', async () => {
      getMock.mockResolvedValue({ data: { items: [{ subtest: 'word' }] } });
      await expect(quizApi.getQabSummary()).rejects.toThrow(
        '서버 응답 형식이 올바르지 않습니다.',
      );
    });
  });
});
