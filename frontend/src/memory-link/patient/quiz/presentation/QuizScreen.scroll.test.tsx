// QuizScreen.tsx — 답한 뒤 "다음 문제"가 화면 안에 들어오는가 (TODO-112)
//
// 연습 화면은 ISSUE-001로 같은 수정을 이미 받았다(PracticeScreen). 검사는 피드백
// 단계가 있어 답한 뒤 붙는 블록의 높이가 달라, 실측 없이 같다고 볼 수 없었다.
//
// **실측(400×720, 2026-08-24).** 그림 격자는 2열, 카드 178px + 간격 12px, 격자
// top 180px. 검사의 피드백 블록(문구 + 버튼)은 124px.
//
//   레벨 1    보기 2개    1행   버튼 바닥 482   들어옴
//   레벨 2~4  보기 3~4개  2행   버튼 바닥 672   들어옴
//   레벨 5    보기 5개    3행   버튼 바닥 862   접힘
//
// TODO-112에는 "4지선다에서 y=888"로 적혀 있었지만 그건 적응 레벨이 붙기 전
// 기준이다. 지금 4지선다는 들어오고 레벨 5의 5지선다만 밀려난다.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QuizScreen } from './QuizScreen.js';
import type { QabImageItem } from '../domain/MixedQuiz.js';

vi.mock('../../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({
    speak: vi.fn().mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 }),
    cancel: vi.fn(),
  }),
}));

/** 레벨 5 = 보기 5개. 격자가 3행이 되어 피드백 블록이 접힌 곳 아래로 간다. */
function fiveChoiceItem(): QabImageItem {
  return {
    itemId: 'qw_001',
    category: 'word',
    promptText: '사과',
    instruction: '들려주는 단어의 그림을 골라주세요',
    presentedLevel: 5,
    choices: [
      { choiceId: 'c1', label: '사과', imageUrl: '/a.svg', isCorrect: true },
      { choiceId: 'c2', label: '바나나', imageUrl: '/b.svg', isCorrect: false },
      { choiceId: 'c3', label: '포도', imageUrl: '/c.svg', isCorrect: false },
      { choiceId: 'c4', label: '사자', imageUrl: '/d.svg', isCorrect: false },
      { choiceId: 'c5', label: '사슴', imageUrl: '/e.svg', isCorrect: false },
    ],
  };
}

function renderQuiz() {
  return render(
    <QuizScreen
      quizSetId="qs-1"
      onExit={() => undefined}
      deps={{
        quizApi: {
          listSets: vi.fn(),
          getSet: vi.fn().mockResolvedValue({
            quizSetId: 'qs-1',
            memoryEntry: { photoUrl: null, caregiverWishMessage: null },
            patientNotes: [],
            questions: [],
          }),
          submitAttempts: vi.fn(),
          getBestScore: vi.fn(),
          getWishPractice: vi.fn(),
          submitQabResults: vi.fn().mockResolvedValue({ saved: 1 }),
          getQabSummary: vi.fn().mockResolvedValue([]),
          getSkillLevels: vi.fn().mockResolvedValue({
            levels: {
              word: 5, sentence: 5, naming: 5, repeat: 5,
              reading: 5, spell: 5, ddk: 5, loc: 5,
            },
            manifestVersion: 3,
          }),
          getActivityDays: vi.fn().mockResolvedValue([]),
          getSessionStats: vi.fn(),
          getRecentItems: vi.fn().mockResolvedValue([]),
          getQabTrend: vi.fn().mockResolvedValue([]),
    getWeekReview: vi.fn().mockResolvedValue([]),
        },
        // rotation: [] — 기본 구성은 오늘 날짜의 로테이션이라, 끄지 않으면
        // 이 테스트가 요일에 따라 다른 문항을 받는다.
        rotation: [],
        pickWordItems: () => [fiveChoiceItem()],
        pickSentItems: () => [],
        pickNamingItems: () => [],
        pickRepeatItems: () => [],
        pickReadingItems: () => [],
        pickSpellItems: () => [],
        pickDdkItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 1,
        sentenceCount: 0,
        namingCount: 0,
        repeatCount: 0,
        readingCount: 0,
        spellCount: 0,
        ddkCount: 0,
      }}
    />,
  );
}

describe('QuizScreen — 답한 뒤 다음 버튼', () => {
  it('피드백이 뜨면 화면 안으로 끌어온다', async () => {
    const scrollIntoView = vi.fn();
    // jsdom에는 scrollIntoView가 아예 없어서 정의부터 해야 한다.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });

    renderQuiz();
    await screen.findByText('들려주는 단어의 그림을 골라주세요');
    // 답하기 전에는 끌어올 것이 없다.
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: /사과/ })[0]);

    await waitFor(() => {
      // block:'nearest'라야 이미 보이는 화면에서는 아무 일도 안 한다.
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        behavior: 'smooth',
      });
    });

    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});
