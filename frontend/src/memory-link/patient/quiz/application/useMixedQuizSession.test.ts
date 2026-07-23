// useMixedQuizSession.ts — 혼합 퀴즈 세션 훅 테스트
//
// 검증 포인트:
//  - 로드: 데일리(주입 mock) + QAB(주입 pick) 인터리브 → total = 합산
//  - QAB 선택: 로컬 채점(isCorrect), 정답/오답 라벨
//  - 데일리 제출: 백엔드 submitAttempts 호출 + 결과 반영
//  - 진행/완료: next로 끝까지 → result, sessionScore = 정답/총 *100

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMixedQuizSession } from './useMixedQuizSession.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';
import type { QabImageItem, QabNamingItem } from '../domain/MixedQuiz.js';
import type { QuizSetDetail } from '../domain/Quiz.js';

const QUIZ_SET_ID = 'set-1';

/** 데일리 2문제짜리 상세(객관식 1 + 빈칸 1) */
function makeDetail(): QuizSetDetail {
  return {
    quizSetId: QUIZ_SET_ID,
    memoryEntry: { photoUrl: null, caregiverWishMessage: null },
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
      {
        id: 'd2',
        orderIndex: 1,
        type: 'fill_blank',
        prompt: '무엇을 ___',
        choices: null,
        hintFirstChar: '바',
        targetWord: null,
      },
    ],
  };
}

/** QAB 질문형 2문제 (단어 1 + 문장 1) */
function makeQabItems(): QabImageItem[] {
  return [
    {
      itemId: 'q1',
      category: 'word',
      promptText: '사과',
      instruction: '들려주는 단어의 그림을 골라주세요',
      choices: [
        { choiceId: 'q1c1', label: '사과', imageUrl: '/a.svg', isCorrect: true },
        { choiceId: 'q1c2', label: '배', imageUrl: '/b.svg', isCorrect: false },
      ],
    },
    {
      itemId: 'q2',
      category: 'sentence',
      promptText: '아이가 사과를 먹어요',
      instruction: '들려주는 문장에 맞는 그림을 골라주세요',
      choices: [
        { choiceId: 'q2c1', label: '산', imageUrl: '/c.svg', isCorrect: false },
        { choiceId: 'q2c2', label: '바다', imageUrl: '/d.svg', isCorrect: true },
      ],
    },
  ];
}

function makeApi(overrides?: Partial<IQuizApi>): IQuizApi {
  return {
    listSets: vi.fn(),
    getSet: vi.fn().mockResolvedValue(makeDetail()),
    submitAttempts: vi.fn().mockResolvedValue({
      results: [{ questionId: 'd1', isCorrect: true, correctAnswer: '공원' }],
      sessionScore: 100,
      completed: false,
    }),
    getBestScore: vi.fn(),
    getWishPractice: vi.fn(),
    submitQabResults: vi.fn().mockResolvedValue({ saved: 0 }),
    getQabSummary: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as IQuizApi;
}

/** QAB 그림 이름대기 1문항 */
function makeNamingItems(): QabNamingItem[] {
  return [
    {
      itemId: 'naming_n1',
      imageUrl: '/apple.svg',
      targetWord: '사과',
      instruction: '그림을 보고 이름을 말해주세요',
    },
  ];
}

/** 새 음성/DDK 검사 카운트를 모두 0으로 끄는 공통 옵션. */
const NO_SPEECH = {
  pickNamingItems: () => [],
  pickRepeatItems: () => [],
  pickReadingItems: () => [],
  pickDdkItems: () => [],
  namingCount: 0,
  repeatCount: 0,
  readingCount: 0,
  ddkCount: 0,
} as const;

function renderMixed(api: IQuizApi) {
  return renderHook(() =>
    useMixedQuizSession(QUIZ_SET_ID, {
      quizApi: api,
      pickQabItems: () => makeQabItems(),
      generateSessionToken: () => 'tok-1',
      dailyCount: 2,
      qabCount: 2,
      ...NO_SPEECH,
    }),
  );
}

describe('useMixedQuizSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('데일리 + QAB를 합쳐 total 4로 로드한다', async () => {
    const { result } = renderMixed(makeApi());
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(result.current[0].total).toBe(4);
    const kinds = ['daily', 'qab'];
    expect(kinds).toContain(result.current[0].currentItem?.kind);
  });

  it('모든 항목을 풀면 결과 단계로 가고 합산 점수를 계산한다', async () => {
    // 데일리는 항상 정답, QAB는 정답 선택 → 4/4 = 100
    const api = makeApi();
    const { result } = renderMixed(api);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    for (let i = 0; i < 4; i += 1) {
      const item = result.current[0].currentItem;
      if (item?.kind === 'daily') {
        await act(async () => {
          await result.current[1].submitDaily('공원');
        });
      } else if (item?.kind === 'qab') {
        const correct = item.item.choices.find((c) => c.isCorrect)!;
        act(() => result.current[1].submitQabChoice(correct.choiceId));
      }
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      expect(result.current[0].lastResult?.isCorrect).toBe(true);
      act(() => result.current[1].next());
    }

    expect(result.current[0].phase).toBe('result');
    expect(result.current[0].sessionScore).toBe(100);
  });

  it('QAB 오답 선택은 로컬에서 isCorrect=false로 채점된다', async () => {
    const { result } = renderMixed(makeApi());
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 첫 QAB 항목이 나올 때까지 진행하며, QAB에서 오답을 선택
    let guard = 0;
    while (result.current[0].currentItem?.kind !== 'qab' && guard < 5) {
      await act(async () => {
        await result.current[1].submitDaily('공원');
      });
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      act(() => result.current[1].next());
      guard += 1;
    }

    const item = result.current[0].currentItem;
    expect(item?.kind).toBe('qab');
    if (item?.kind === 'qab') {
      const wrong = item.item.choices.find((c) => !c.isCorrect)!;
      act(() => result.current[1].submitQabChoice(wrong.choiceId));
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      expect(result.current[0].lastResult?.isCorrect).toBe(false);
      expect(result.current[0].selectedChoiceId).toBe(wrong.choiceId);
    }
  });

  it('그림 이름대기를 포함해 total을 늘리고 STT로 로컬 채점한다', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickNamingItems: () => makeNamingItems(),
        namingCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    expect(result.current[0].total).toBe(1);
    expect(result.current[0].currentItem?.kind).toBe('naming');

    // 관대 채점: "사과요" → "사과" 정답 처리
    act(() => result.current[1].submitNaming('사과요'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(true);
    expect(result.current[0].lastResult?.correctLabel).toBe('사과');
  });

  it('그림 이름대기 오답은 isCorrect=false로 채점된다', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickNamingItems: () => makeNamingItems(),
        namingCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    act(() => result.current[1].submitNaming('바나나'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(false);
  });

  it('따라말하기(repeat)는 WER로 로컬 채점한다', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickRepeatItems: () => [
          {
            itemId: 'rp1',
            category: 'sentence',
            text: '오늘 날씨가 좋아요',
            instruction: '따라 말해주세요',
          },
        ],
        repeatCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(result.current[0].currentItem?.kind).toBe('repeat');

    act(() => result.current[1].submitSpeech('오늘 날씨가 좋아요'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(true);
  });

  it('소리 내어 읽기(reading)는 어절 단위 WER로 채점한다', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickReadingItems: () => [
          {
            itemId: 'rd1',
            text: '산 위에 해가 떠올라요',
            instruction: '읽어주세요',
          },
        ],
        readingCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(result.current[0].currentItem?.kind).toBe('reading');

    // 전혀 다른 발화 → 오답
    act(() => result.current[1].submitSpeech('전혀 다른 말이에요'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(false);
  });

  it('말운동(ddk)은 목표 횟수 이상이면 통과한다', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickDdkItems: () => [
          {
            itemId: 'dk1',
            syllable: '퍼',
            label: '퍼',
            targetCount: 10,
            instruction: '빠르게 반복하세요',
          },
        ],
        ddkCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(result.current[0].currentItem?.kind).toBe('ddk');

    act(() => result.current[1].submitDdk(12));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(true);

    act(() => result.current[1].next());
    expect(result.current[0].phase).toBe('result');
  });

  it('세션 완료 시 QAB 결과를 백엔드에 일괄 저장한다(metric 포함)', async () => {
    const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickDdkItems: () => [
          {
            itemId: 'ddk_0',
            syllable: '퍼',
            label: '퍼',
            targetCount: 10,
            instruction: '빠르게 반복하세요',
          },
        ],
        ddkCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    act(() => result.current[1].submitDdk(11));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());

    expect(result.current[0].phase).toBe('result');
    expect(submitQabResults).toHaveBeenCalledWith('tok-1', [
      { subtest: 'ddk', itemRef: 'ddk_0', isCorrect: true, metric: 11 },
    ]);
  });

  it('넘어가기(skipCurrent)는 도움받음(assisted)으로 기록하고 긍정 피드백을 준다', async () => {
    const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickNamingItems: () => makeNamingItems(),
        namingCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(result.current[0].currentItem?.kind).toBe('naming');

    act(() => result.current[1].skipCurrent());
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    // 환자에겐 긍정 피드백
    expect(result.current[0].lastResult?.isCorrect).toBe(true);

    act(() => result.current[1].next());
    expect(result.current[0].phase).toBe('result');
    // 추세 기록은 assisted=true
    expect(submitQabResults).toHaveBeenCalledWith('tok-1', [
      { subtest: 'naming', itemRef: 'naming_n1', isCorrect: true, assisted: true },
    ]);
  });
});
