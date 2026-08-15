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
    getSkillLevels: vi.fn().mockResolvedValue({
      levels: {
        word: 2, sentence: 2, naming: 2, repeat: 2, reading: 2, ddk: 2, loc: 2,
      },
      manifestVersion: 1,
    }),
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

  it('발음 점수가 좋으면 STT 전사가 어긋나도 정답 처리한다(단어 STT 불신뢰 보정)', async () => {
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

    // 단어 STT는 '바나나'로 완전히 어긋났지만(단어 CER 실측 ≈ 0.70), 음소 정확도는
    // 높다 → 발음 평가로 채점해 정답 처리(자유 STT였다면 억울한 오답이 됐을 상황).
    act(() =>
      result.current[1].submitNaming('바나나', {
        accuracyScore: 85,
        fluencyScore: 90,
        completenessScore: 100,
        pronunciationScore: 86,
        prosodyScore: null,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(true);
  });

  it('보호자 정정: 자동 오답을 정답으로 뒤집으면 판정·점수가 반영되고, 미보조 정답으로 기록된다', async () => {
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

    // 자동 채점: 완전히 다른 전사 + azure 없음 → 오답
    act(() => result.current[1].submitNaming('바나나'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(false);

    // 보호자가 "실제론 맞게 말했다"며 정답으로 정정
    act(() => result.current[1].overrideSpeechVerdict(true));
    expect(result.current[0].lastResult?.isCorrect).toBe(true);

    // 마지막 문항 → 결과로 이동, 점수에 정정이 반영(1/1 = 100)
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    expect(result.current[0].sessionScore).toBe(100);
    // 정정은 '도움'이 아니다 — 환자가 독립적으로 맞혔으므로 assisted로 찍히면 안 됨
    // (회복추적에서 빠져 실력이 과소평가되는 것 방지).
    expect(submitQabResults).toHaveBeenCalledWith(
      'tok-1',
      [{ subtest: 'naming', itemRef: 'naming_n1', isCorrect: true }],
      1,
    );
  });

  it('점진 제출: 문항을 넘길 때마다 부분 저장해 중도 이탈을 포착한다', async () => {
    const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
    const twoNaming: QabNamingItem[] = [
      { itemId: 'naming_a', imageUrl: '/a.svg', targetWord: '사과', instruction: 'x' },
      { itemId: 'naming_b', imageUrl: '/b.svg', targetWord: '바나나', instruction: 'x' },
    ];
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickNamingItems: () => twoNaming,
        namingCount: 2,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(result.current[0].total).toBe(2);

    // 1번째 문항 답 → 넘기기. 세션이 아직 안 끝났는데도 그 결과가 저장돼야 한다
    // (중도 이탈 시에도 진행분·이탈 지점이 남게 하는 게 ADP-001의 목적).
    act(() => result.current[1].submitNaming('사과'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    expect(submitQabResults).toHaveBeenCalledTimes(1); // 세션 끝 전에 이미 1회 저장
    const firstPayload = submitQabResults.mock.calls[0][1];
    expect(firstPayload).toHaveLength(1); // 아직 안 보낸 tail(1개)만 부분 저장
  });

  it('피로 탈출: 연속 오답 3회면 남은 문항이 있어도 세션을 조기 종료한다', async () => {
    const fourNaming: QabNamingItem[] = [1, 2, 3, 4].map((n) => ({
      itemId: `naming_${n}`,
      imageUrl: `/${n}.svg`,
      targetWord: '사과',
      instruction: 'x',
    }));
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickNamingItems: () => fourNaming,
        namingCount: 4,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(result.current[0].total).toBe(4);

    // 3연속 오답
    for (let i = 0; i < 3; i += 1) {
      act(() => result.current[1].submitNaming('전혀다른말'));
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      expect(result.current[0].lastResult?.isCorrect).toBe(false);
      act(() => result.current[1].next());
    }

    // 4번째 문항이 남았지만 피로 탈출로 결과 화면으로 종료
    await waitFor(() => expect(result.current[0].phase).toBe('result'));
  });

  it('정답이 중간에 나오면 연속 오답이 리셋돼 피로 탈출하지 않는다', async () => {
    const fourNaming: QabNamingItem[] = [1, 2, 3, 4].map((n) => ({
      itemId: `naming_${n}`,
      imageUrl: `/${n}.svg`,
      targetWord: '사과',
      instruction: 'x',
    }));
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickNamingItems: () => fourNaming,
        namingCount: 4,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 오답, 오답, 정답(리셋), 오답 → 최대 연속 2 → 조기 종료 안 함
    const answers = ['틀린말', '틀린말', '사과', '틀린말'];
    for (let i = 0; i < answers.length; i += 1) {
      act(() => result.current[1].submitNaming(answers[i]));
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      act(() => result.current[1].next());
    }
    // 4문항 다 풀어 자연 종료(피로 탈출 아님)
    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    // 정답 1개 반영(1/4 = 25)
    expect(result.current[0].sessionScore).toBe(25);
  });

  it('보호자가 오채점을 정답으로 정정하면 피로 탈출이 발동하지 않는다', async () => {
    // STT가 3연속 오답으로 잘못 채점했지만 보호자가 매번 정답으로 정정 → 실제론
    // 다 맞은 것이므로 조기 종료되면 안 된다(정정이 연속오답 로그를 뒤집어야 함).
    const fourNaming: QabNamingItem[] = [1, 2, 3, 4].map((n) => ({
      itemId: `naming_${n}`,
      imageUrl: `/${n}.svg`,
      targetWord: '사과',
      instruction: 'x',
    }));
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickNamingItems: () => fourNaming,
        namingCount: 4,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    for (let i = 0; i < 3; i += 1) {
      act(() => result.current[1].submitNaming('전혀다른말')); // 오채점(오답)
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      act(() => result.current[1].overrideSpeechVerdict(true)); // 보호자 정정
      act(() => result.current[1].next());
    }

    // 3연속이 전부 정정됐으므로 피로 탈출 없이 4번째 문항을 진행 중이어야 한다
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(result.current[0].currentIndex).toBe(3);
  });

  it('보호자 정정: 같은 판정으로는 점수를 이중 반영하지 않는다', async () => {
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

    act(() => result.current[1].submitNaming('사과요')); // 자동 정답
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    // 이미 정답인데 또 정답으로 정정 → 무변화(이중 가산 없음)
    act(() => result.current[1].overrideSpeechVerdict(true));
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    expect(result.current[0].sessionScore).toBe(100);
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

  it('보호자 정정은 따라말하기(repeat)에도 적용된다(발음평가 폴백 보정)', async () => {
    const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickRepeatItems: () => [
          {
            itemId: 'rp1',
            category: 'word',
            text: '바다',
            instruction: '따라 말해주세요',
          },
        ],
        repeatCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 발음평가 없이 문자열 폴백 → 완전히 다른 전사라 오답
    act(() => result.current[1].submitSpeech('바나나'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(false);

    // 보호자가 정답으로 정정 → 판정·점수 반영, 미보조 정답으로 기록(assisted 없음)
    act(() => result.current[1].overrideSpeechVerdict(true));
    expect(result.current[0].lastResult?.isCorrect).toBe(true);
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    expect(result.current[0].sessionScore).toBe(100);
    expect(submitQabResults).toHaveBeenCalledWith(
      'tok-1',
      [{ subtest: 'repeat', itemRef: 'rp1', isCorrect: true, score: expect.any(Number) }],
      1,
    );
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

  it('오답 후 answerAgain으로 다시 답하면 이전 오답을 되돌리고 점수를 이중 집계하지 않는다', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickQabItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        qabCount: 0,
        ...NO_SPEECH,
        pickReadingItems: () => [
          { itemId: 'rd1', text: '산 위에 해가 떠올라요', instruction: '읽어주세요' },
        ],
        readingCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 1) 오답 → 피드백
    act(() => result.current[1].submitSpeech('전혀 다른 말이에요'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(false);

    // 2) 다시 말하기 → answering 복귀 + attempt 증가 + 결과 초기화
    act(() => result.current[1].answerAgain());
    expect(result.current[0].phase).toBe('answering');
    expect(result.current[0].attempt).toBe(1);
    expect(result.current[0].lastResult).toBeNull();

    // 3) 이번엔 정답 → 피드백
    act(() => result.current[1].submitSpeech('산 위에 해가 떠올라요'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    expect(result.current[0].lastResult?.isCorrect).toBe(true);

    // 4) 다음 → 결과. 1문항이 최종 정답이므로 100점(오답이 이중 집계됐다면 다른 값).
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    expect(result.current[0].sessionScore).toBe(100);
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
    expect(submitQabResults).toHaveBeenCalledWith(
      'tok-1',
      [{ subtest: 'ddk', itemRef: 'ddk_0', isCorrect: true, metric: 11 }],
      1,
    );
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
    expect(submitQabResults).toHaveBeenCalledWith(
      'tok-1',
      [{ subtest: 'naming', itemRef: 'naming_n1', isCorrect: true, assisted: true }],
      1,
    );
  });
});
