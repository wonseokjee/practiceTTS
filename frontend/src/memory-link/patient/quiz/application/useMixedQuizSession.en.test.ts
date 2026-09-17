// useMixedQuizSession.ts를 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 준비 안 됨 에러·DDK correctLabel이
// 영어로 나온다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { i18n } from '../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import { useMixedQuizSession } from './useMixedQuizSession.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';
import type { QuizSetDetail } from '../domain/Quiz.js';

const QUIZ_SET_ID = 'set-1';

function makeDetail(): QuizSetDetail {
  return {
    quizSetId: QUIZ_SET_ID,
    memoryEntry: { photoUrl: null, caregiverWishMessage: null },
    patientNotes: [],
    questions: [],
  };
}

function makeApi(overrides?: Partial<IQuizApi>): IQuizApi {
  return {
    listSets: vi.fn(),
    getSet: vi.fn().mockResolvedValue(makeDetail()),
    submitAttempts: vi.fn(),
    getBestScore: vi.fn(),
    getWishPractice: vi.fn(),
    submitQabResults: vi.fn().mockResolvedValue({ saved: 0 }),
    getQabSummary: vi.fn().mockResolvedValue([]),
    getSkillLevels: vi.fn().mockResolvedValue({ levels: {}, manifestVersion: 1 }),
    getActivityDays: vi.fn().mockResolvedValue([]),
    getSessionStats: vi.fn(),
    getRecentItems: vi.fn().mockResolvedValue([]),
    getQabTrend: vi.fn().mockResolvedValue([]),
    getWeekReview: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const ISOLATED = {
  rotation: [],
  pickNamingItems: () => [],
  pickRepeatItems: () => [],
  pickReadingItems: () => [],
  pickSpellItems: () => [],
  pickDdkItems: () => [],
  pickSentItems: () => [],
  pickWordItems: () => [],
  namingCount: 0,
  repeatCount: 0,
  readingCount: 0,
  spellCount: 0,
  ddkCount: 0,
  sentenceCount: 0,
  wordCount: 0,
  dailyCount: 0,
} as const;

describe('useMixedQuizSession — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('문항이 하나도 없으면 에러 문구가 영어', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        generateSessionToken: () => 'tok-1',
        ...ISOLATED,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('error'));
    expect(result.current[0].error).toBe("The items aren't ready yet.");
  });

  it('말운동(ddk) correctLabel이 영어', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        generateSessionToken: () => 'tok-1',
        ...ISOLATED,
        pickDdkItems: () => [
          {
            itemId: 'dk1',
            syllable: 'pa',
            label: 'pa',
            targetCount: 10,
            instruction: 'Repeat quickly',
          },
        ],
        ddkCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    act(() => result.current[1].submitDdk(3));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.correctLabel).toBe('10 or more');
  });
});
