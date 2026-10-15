// QuizScreen.tsx — 오늘 연습(세트 없이 시작)에서 보호자 한마디·기억 문항
//
// 오늘 연습은 quizSetId 없이 시작하고 세션이 붙일 세트를 스스로 고른다. 그래서
// 한마디 카드에 prop을 그대로 넘기면 빈칸 연습 조회가 빈 id로 나간다 — 세션이
// 실제로 붙인 세트 id가 가야 한다.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuizScreen } from './QuizScreen.js';
import { quizApi as realQuizApi } from '../infrastructure/QuizApi.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';

vi.mock('../../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({
    speak: vi.fn().mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 }),
    cancel: vi.fn(),
  }),
}));

function makeApi(): IQuizApi {
  return {
    listSets: vi.fn(),
    getFreshSetId: vi.fn().mockResolvedValue('fresh-9'),
    getSet: vi.fn().mockResolvedValue({
      quizSetId: 'fresh-9',
      memoryEntry: { photoUrl: null, caregiverWishMessage: '오늘도 고마워요' },
      patientNotes: [],
      questions: [
        {
          id: 'd1',
          orderIndex: 0,
          type: 'multiple_choice',
          prompt: '어디 갔나요?',
          choices: ['공원', '집', '병원', '시장'],
          hintFirstChar: null,
          targetWord: null,
        },
      ],
    }),
    submitAttempts: vi.fn(),
    getBestScore: vi.fn(),
    getWishPractice: vi.fn(),
    submitQabResults: vi.fn().mockResolvedValue({ saved: 0 }),
    getQabSummary: vi.fn().mockResolvedValue([]),
    getSkillLevels: vi.fn().mockRejectedValue(new Error('skip')),
    getActivityDays: vi.fn().mockResolvedValue([]),
    getSessionStats: vi.fn(),
    getRecentItems: vi.fn().mockResolvedValue([]),
    getQabTrend: vi.fn().mockResolvedValue([]),
    getWeekReview: vi.fn().mockResolvedValue([]),
  };
}

function renderToday() {
  return render(
    <QuizScreen
      onExit={() => undefined}
      deps={{
        quizApi: makeApi(),
        rotation: [],
        pickWordItems: () => [],
        pickSentItems: () => [],
        pickNamingItems: () => [],
        pickRepeatItems: () => [],
        pickReadingItems: () => [],
        pickSpellItems: () => [],
        pickDdkItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 2,
      }}
    />,
  );
}

describe('QuizScreen — 오늘 연습', () => {
  afterEach(() => vi.restoreAllMocks());

  it('한마디 카드는 세션이 붙인 세트 id로 빈칸 연습을 부른다', async () => {
    // 카드는 주입 api가 아니라 모듈 quizApi를 쓴다.
    const spy = vi
      .spyOn(realQuizApi, 'getWishPractice')
      .mockRejectedValue(new Error('not needed'));
    renderToday();
    fireEvent.click(await screen.findByRole('tab', { name: '빈칸 채우기' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('fresh-9'));
  });

  it('한마디 다음 첫 기억 문항에 출처 한 줄이 보인다', async () => {
    renderToday();
    fireEvent.click(await screen.findByRole('button', { name: '퀴즈 풀이로 이동' }));
    expect(await screen.findByText('가족이 들려준 이야기예요')).toBeInTheDocument();
    expect(screen.getByText('어디 갔나요?')).toBeInTheDocument();
  });
});
