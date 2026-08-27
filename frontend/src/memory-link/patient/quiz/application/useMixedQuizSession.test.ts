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
import type {
  QabDdkItem,
  QabImageItem,
  QabNamingItem,
  QabSpellItem,
} from '../domain/MixedQuiz.js';
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
        word: 2, sentence: 2, naming: 2, repeat: 2, reading: 2, spell: 2,
        ddk: 2, loc: 2,
      },
      manifestVersion: 1,
    }),
    getActivityDays: vi.fn().mockResolvedValue([]),
    getSessionStats: vi.fn(),
    getRecentItems: vi.fn().mockResolvedValue([]),
    getQabTrend: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  // `as IQuizApi` 캐스트를 쓰지 않는다. 캐스트하면 인터페이스에 메서드가 늘어도
  // 목이 비어 있는 걸 타입이 못 잡고, 런타임에 "not defined on the object"로
  // 터진다(실제로 getRecentItems를 추가하며 그렇게 터졌다).
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

/**
 * 세션 구성을 테스트가 완전히 통제한다.
 *
 * 기본 구성은 **오늘 날짜의 로테이션**(하루 세 검사)이라, 비워 두면 같은 테스트가
 * 요일에 따라 통과하거나 실패한다. `rotation: []`로 끄고, 필요한 검사만 각
 * 테스트가 개수로 켠다. 산출 과제(음성·글자조합·DDK)와 문장도 여기서 0으로 둔다.
 */
const ISOLATED = {
  rotation: [],
  pickNamingItems: () => [],
  pickRepeatItems: () => [],
  pickReadingItems: () => [],
  pickSpellItems: () => [],
  pickDdkItems: () => [],
  pickSentItems: () => [],
  namingCount: 0,
  repeatCount: 0,
  readingCount: 0,
  spellCount: 0,
  ddkCount: 0,
  sentenceCount: 0,
} as const;

function makeSpellItems(): QabSpellItem[] {
  return [
    {
      itemId: 'spell_w1',
      targetWord: '사과',
      imageUrl: '/apple.svg',
      tiles: ['과', '사'],
      instruction: '글자를 눌러 낱말을 만들어 보세요',
      presentedLevel: 2,
    },
  ];
}

function renderMixed(api: IQuizApi) {
  return renderHook(() =>
    useMixedQuizSession(QUIZ_SET_ID, {
      quizApi: api,
      pickWordItems: () => makeQabItems(),
      generateSessionToken: () => 'tok-1',
      dailyCount: 2,
      wordCount: 2,
      ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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

  /**
   * **오답의 갈래를 남긴다.**
   *
   * 정답률 하나로는 "무엇이 어려운지"를 말할 수 없다. 의미 오답('사과'에 대한
   * '바나나')을 반복해 고르는 것과 음운 오답('사자')을 반복해 고르는 것은 서로
   * 다른 손상이다. 뱅크가 뽑을 때 붙여 둔 갈래를 그대로 실어 보낸다.
   */
  describe('오답 갈래(foilKind) 전송', () => {
    /** 갈래가 붙은 4지선다 단어이해 1문항. */
    function taggedWordItem(): QabImageItem {
      return {
        itemId: 'qw_001',
        category: 'word',
        promptText: '사과',
        instruction: '들으신 낱말의 그림을 골라주세요',
        choices: [
          { choiceId: 'c_ok', label: '사과', imageUrl: '/a.svg', isCorrect: true },
          {
            choiceId: 'c_sem',
            label: '바나나',
            imageUrl: '/b.svg',
            isCorrect: false,
            foilKind: 'semantic',
          },
          {
            choiceId: 'c_phon',
            label: '사자',
            imageUrl: '/c.svg',
            isCorrect: false,
            foilKind: 'phonological',
          },
        ],
      };
    }

    // `ReturnType<typeof vi.fn>`은 Mock<Procedure | Constructable>로 너무 넓어
    // IQuizApi.submitQabResults 자리에 안 들어간다. 목이 흉내 내는 실제
    // 시그니처를 그대로 쓴다 — tsc -b가 잡아준 오류다(--noEmit은 침묵했다).
    function renderWordOnly(submitQabResults: IQuizApi['submitQabResults']) {
      return renderHook(() =>
        useMixedQuizSession(QUIZ_SET_ID, {
          quizApi: makeApi({ submitQabResults }),
          pickWordItems: () => [taggedWordItem()],
          generateSessionToken: () => 'tok-1',
          dailyCount: 0,
          wordCount: 1,
          ...ISOLATED,
        }),
      );
    }

    it('음운 오답을 고르면 그 갈래가 실려 나간다', async () => {
      const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
      const { result } = renderWordOnly(submitQabResults);
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      act(() => result.current[1].submitQabChoice('c_phon'));
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      act(() => result.current[1].next());
      await waitFor(() => expect(result.current[0].phase).toBe('result'));

      expect(submitQabResults.mock.calls[0][1]).toEqual([
        {
          subtest: 'word',
          itemRef: 'qw_001',
          isCorrect: false,
          foilKind: 'phonological',
        },
      ]);
    });

    it('의미 오답을 고르면 그 갈래가 실려 나간다', async () => {
      const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
      const { result } = renderWordOnly(submitQabResults);
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      act(() => result.current[1].submitQabChoice('c_sem'));
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      act(() => result.current[1].next());
      await waitFor(() => expect(result.current[0].phase).toBe('result'));

      expect(submitQabResults.mock.calls[0][1][0]).toMatchObject({
        foilKind: 'semantic',
      });
    });

    it('맞히면 갈래를 보내지 않는다', async () => {
      // 정답에는 갈래가 없다. 맞힌 행에 갈래가 붙으면 갈래별 집계가 틀어진다.
      const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
      const { result } = renderWordOnly(submitQabResults);
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      act(() => result.current[1].submitQabChoice('c_ok'));
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      act(() => result.current[1].next());
      await waitFor(() => expect(result.current[0].phase).toBe('result'));

      expect(submitQabResults.mock.calls[0][1][0]).not.toHaveProperty(
        'foilKind',
      );
    });

    it('갈래가 없는 선택지(문장이해)는 필드를 만들지 않는다', async () => {
      // 문장이해는 선택지가 JSON 고정 그림 쌍이라 갈래가 없다. 없는 것을
      // 'unrelated'로 채우면 없는 사실이 생긴다.
      const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
      const { result } = renderHook(() =>
        useMixedQuizSession(QUIZ_SET_ID, {
          quizApi: makeApi({ submitQabResults }),
          pickWordItems: () => [
            {
              itemId: 'sentComp_01',
              category: 'sentence' as const,
              promptText: '남자가 여자를 쫓는다',
              instruction: '들으신 문장의 그림을 골라주세요',
              choices: [
                { choiceId: 's_ok', label: 'A', imageUrl: '/x.png', isCorrect: true },
                { choiceId: 's_no', label: 'B', imageUrl: '/y.png', isCorrect: false },
              ],
            },
          ],
          generateSessionToken: () => 'tok-1',
          dailyCount: 0,
          wordCount: 1,
          ...ISOLATED,
        }),
      );
      await waitFor(() => expect(result.current[0].phase).toBe('answering'));

      act(() => result.current[1].submitQabChoice('s_no'));
      await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
      act(() => result.current[1].next());
      await waitFor(() => expect(result.current[0].phase).toBe('result'));

      expect(submitQabResults.mock.calls[0][1][0]).not.toHaveProperty(
        'foilKind',
      );
    });
  });

  it('보호자 정정: 자동 오답을 정답으로 뒤집으면 판정·점수가 반영되고, 미보조 정답으로 기록된다', async () => {
    const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
      true, // 마지막 문항 → 세션 자연 종료 → 완료 마커
      undefined, // 이름대기는 비레벨 검사라 보고할 눈높이가 없다
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
    // 세션 중간 flush는 완료 마커를 보내지 않는다(중도 이탈로 남아야 함).
    expect(submitQabResults.mock.calls[0][3]).toBeFalsy();
  });

  it('완료 마커: 세션이 끝까지 끝나면 마지막 flush에 completed=true를 보낸다', async () => {
    const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
    const twoNaming: QabNamingItem[] = [
      { itemId: 'naming_a', imageUrl: '/a.svg', targetWord: '사과', instruction: 'x' },
      { itemId: 'naming_b', imageUrl: '/b.svg', targetWord: '바나나', instruction: 'x' },
    ];
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickNamingItems: () => twoNaming,
        namingCount: 2,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 1번째 문항: 세션 안 끝남 → completed 안 보냄
    act(() => result.current[1].submitNaming('사과'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(submitQabResults.mock.calls[0][3]).toBeFalsy();

    // 2번째(마지막) 문항: 세션 끝 → completed=true
    act(() => result.current[1].submitNaming('바나나'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    expect(submitQabResults).toHaveBeenCalledTimes(2);
    expect(submitQabResults.mock.calls[1][3]).toBe(true);
  });

  it('완료 마커: 화면 이탈(언마운트) 시 best-effort flush는 완료로 남기지 않는다', async () => {
    const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
    const twoNaming: QabNamingItem[] = [
      { itemId: 'naming_a', imageUrl: '/a.svg', targetWord: '사과', instruction: 'x' },
      { itemId: 'naming_b', imageUrl: '/b.svg', targetWord: '바나나', instruction: 'x' },
    ];
    const { result, unmount } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickNamingItems: () => twoNaming,
        namingCount: 2,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 1번째 문항만 답하고 next()를 누르지 않은 채(피드백 단계) 화면을 떠난다
    // — 중도 이탈 시나리오. 세션은 안 끝났으므로 완료 마커가 남으면 안 된다.
    act(() => result.current[1].submitNaming('사과'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));

    unmount();

    expect(submitQabResults).toHaveBeenCalledTimes(1);
    expect(submitQabResults.mock.calls[0][3]).toBeFalsy();
  });
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
      true, // 마지막 문항 → 세션 자연 종료 → 완료 마커
      // 1문항 정답으로는 승급 임계(3연속)에 못 미쳐 시작 레벨 그대로 보고한다.
      { repeat: 2 },
    );
  });

  it('소리 내어 읽기(reading)는 어절 단위 WER로 채점한다', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
      true, // 마지막 문항 → 세션 자연 종료 → 완료 마커
      { ddk: 2 },
    );
  });

  it('넘어가기(skipCurrent)는 도움받음(assisted)으로 기록하고 긍정 피드백을 준다', async () => {
    const submitQabResults = vi.fn().mockResolvedValue({ saved: 1 });
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-1',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
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
      true, // 마지막 문항 → 세션 자연 종료 → 완료 마커
      undefined, // 도움받은 문항은 적응 기록에 안 들어간다
    );
  });

describe('글자 조합(spell)', () => {
  // 이 과제는 예전에 보호자 메모 기반 빈칸을 변환해 만들었다. 그러면 한 문항이
  // 기억 회상과 음절 조합을 동시에 물어 무엇을 못한 건지 분리되지 않았고,
  // 매일 다른 문항이라 같은 목표가 반복되지도 않았다. 커리큘럼 단어 풀 기반의
  // 독립 검사로 옮기면서 subtest도 따로 뒀다.

  it('타일로 만든 낱말이 목표와 같으면 정답', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-spell',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickSpellItems: () => makeSpellItems(),
        spellCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    expect(result.current[0].currentItem?.kind).toBe('spell');

    act(() => result.current[1].submitSpell('사과'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));

    expect(result.current[0].lastResult?.isCorrect).toBe(true);
  });

  it('다르게 조합하면 오답이고 정답을 알려준다', async () => {
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-spell2',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickSpellItems: () => makeSpellItems(),
        spellCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    act(() => result.current[1].submitSpell('과사'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));

    expect(result.current[0].lastResult?.isCorrect).toBe(false);
    expect(result.current[0].lastResult?.correctLabel).toBe('사과');
  });

  it('결과를 subtest `spell`로 제출하고 제시 레벨을 함께 보낸다', async () => {
    // word(듣고 고르기=이해)와 섞이면 두 능력의 신호가 한 레벨로 뭉개진다.
    const api = makeApi();
    const spy = vi.spyOn(api, 'submitQabResults');
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: api,
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-spell3',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickSpellItems: () => makeSpellItems(),
        spellCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    act(() => result.current[1].submitSpell('사과'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        subtest: 'spell',
        itemRef: 'spell_w1',
        isCorrect: true,
        presentedLevel: 2,
      }),
    ]);
  });

  it('넘어가기는 도움받음으로 기록한다', async () => {
    const api = makeApi();
    const spy = vi.spyOn(api, 'submitQabResults');
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: api,
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-spell4',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickSpellItems: () => makeSpellItems(),
        spellCount: 1,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    act(() => result.current[1].skipCurrent());
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toEqual([
      expect.objectContaining({ subtest: 'spell', assisted: true }),
    ]);
  });
});

describe('발화 검사 — 눈높이 배선', () => {
  /**
   * 예전엔 따라말하기·읽기·말운동만 레벨을 **안 받고** 문항을 골랐다. 그런데
   * 보호자 화면은 loc를 뺀 모든 검사에 1~5단계가 있다고 표시했다 — 보호자가
   * 없는 회복을(또는 없는 악화를) 있다고 믿게 되는 거짓 신호였다.
   *
   * 뱅크가 레벨을 제대로 쓰는지는 QabSpeechBank.test.ts가 본다. 여기서 보는 건
   * **세션이 서버 레벨을 뱅크까지 실어 나르는가**다. 배선이 끊기면 뱅크가 아무리
   * 옳아도 환자는 콜드스타트 난이도만 받는다.
   */
  async function arrangeLevels(levels: Record<string, number>, token: string) {
    const api = makeApi();
    vi.spyOn(api, 'getSkillLevels').mockResolvedValue({
      levels: {
        word: 2, sentence: 2, naming: 2, repeat: 2, reading: 2, spell: 2,
        ddk: 2, loc: 2, ...levels,
      },
      manifestVersion: 1,
    } as Awaited<ReturnType<IQuizApi['getSkillLevels']>>);
    const repeat = vi.fn().mockReturnValue([]);
    const reading = vi.fn().mockReturnValue([]);
    const ddk = vi.fn().mockReturnValue([]);

    renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: api,
        pickWordItems: () => [],
        generateSessionToken: () => token,
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickRepeatItems: repeat,
        pickReadingItems: reading,
        pickDdkItems: ddk,
        repeatCount: 1,
        readingCount: 1,
        ddkCount: 1,
      }),
    );

    await waitFor(() => expect(repeat).toHaveBeenCalled());
    return { repeat, reading, ddk };
  }

  it('서버 레벨을 따라말하기·읽기·말운동 뱅크에 그대로 넘긴다', async () => {
    const { repeat, reading, ddk } = await arrangeLevels(
      { repeat: 5, reading: 4, ddk: 3 },
      'tok-speech-lv',
    );

    expect(repeat.mock.calls[0][1]).toBe(5);
    expect(reading.mock.calls[0][1]).toBe(4);
    expect(ddk.mock.calls[0][1]).toBe(3);
  });

  it('레벨 조회가 실패해도 세션은 진행된다(뱅크가 콜드스타트로 떨어진다)', async () => {
    const api = makeApi();
    vi.spyOn(api, 'getSkillLevels').mockRejectedValue(new Error('network'));
    const repeat = vi.fn().mockReturnValue([]);

    renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: api,
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-speech-fail',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickRepeatItems: repeat,
        repeatCount: 1,
      }),
    );

    await waitFor(() => expect(repeat).toHaveBeenCalled());
    expect(repeat.mock.calls[0][1]).toBeUndefined();
  });
});

describe('글자 조합 — 반복과 중복 방지', () => {
  /** 우선순위 배선만 보는 렌더 헬퍼 — 이력 응답을 주고 pickSpellItems 인자를 돌려준다. */
  async function arrangePriority(
    recent: Awaited<ReturnType<IQuizApi['getRecentItems']>>,
    token: string,
  ) {
    const api = makeApi();
    vi.spyOn(api, 'getRecentItems').mockResolvedValue(recent);
    const spy = vi.fn().mockReturnValue(makeSpellItems());

    renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: api,
        pickWordItems: () => [],
        generateSessionToken: () => token,
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickSpellItems: spy,
        spellCount: 1,
      }),
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());
    return spy.mock.calls[0][2];
  }

  it('이력 순서를 그대로 우선순위로 넘긴다 — 이 순서가 곧 간격 반복이다', async () => {
    // 백엔드가 (틀린 것 먼저, 그 안에서 마지막 출제가 오래된 것 먼저) 순으로
    // 주므로, 프론트는 **재정렬하지 않는다.** 여기서 순서를 건드리면 간격이 깨진다.
    const opts = await arrangePriority(
      [
        { itemRef: 'spell_w9', lastCorrect: false, lastAt: '2026-08-01T00:00:00Z' },
        { itemRef: 'spell_w1', lastCorrect: true, lastAt: '2026-06-01T00:00:00Z' },
        { itemRef: 'spell_w4', lastCorrect: true, lastAt: '2026-08-16T00:00:00Z' },
      ],
      'tok-order',
    );

    expect(opts.priority).toEqual(['spell_w9', 'spell_w1', 'spell_w4']);
  });

  it('맞힌 문항도 우선순위에 남긴다 — 빼면 간격이 아니라 무작위가 된다', async () => {
    // 한때 `.filter(!lastCorrect)`로 맞힌 문항을 버렸다. 그러면 "틀린 것 우선"일
    // 뿐 시간 축이 없어서, 맞힌 낱말은 다음 세션에 우연히 또 나올 수도 영영 안
    // 나올 수도 있다. 실어증 치료 이득은 훈련한 그 항목을 크게 넘어가지 않으므로
    // (limited transfer), 맞힌 낱말도 **간격을 두고 다시** 나와야 유지가 된다.
    const opts = await arrangePriority(
      [
        { itemRef: 'spell_w1', lastCorrect: true, lastAt: '2026-06-01T00:00:00Z' },
        { itemRef: 'spell_w4', lastCorrect: true, lastAt: '2026-08-16T00:00:00Z' },
      ],
      'tok-keep',
    );

    expect(opts.priority).toEqual(['spell_w1', 'spell_w4']);
  });

  it('같은 세션의 단어이해 정답은 글자 조합에서 제외한다', async () => {
    // 단어이해가 정답 단어를 TTS로 들려주므로 겹치면 답을 알려준 셈이 된다.
    const spy = vi.fn().mockReturnValue(makeSpellItems());

    renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi(),
        pickWordItems: () => [
          {
            itemId: 'w_apple',
            category: 'word',
            promptText: '사과',
            choices: [
              { choiceId: 'c1', label: '사과', imageUrl: '/a.svg', isCorrect: true },
            ],
            instruction: '들은 것을 고르세요',
          },
        ],
        generateSessionToken: () => 'tok-dup',
        dailyCount: 0,
        wordCount: 1,
        ...ISOLATED,
        pickSpellItems: spy,
        spellCount: 1,
      }),
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][2].exclude).toContain('사과');
  });

  it('이력 조회가 실패해도 세션은 진행된다', async () => {
    // 반복은 있으면 좋은 것이지 세션을 막을 이유가 아니다.
    const api = makeApi();
    vi.spyOn(api, 'getRecentItems').mockRejectedValue(new Error('network'));
    const spy = vi.fn().mockReturnValue(makeSpellItems());

    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: api,
        pickWordItems: () => [],
        generateSessionToken: () => 'tok-fail',
        dailyCount: 0,
        wordCount: 0,
        ...ISOLATED,
        pickSpellItems: spy,
        spellCount: 1,
      }),
    );

    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    expect(spy.mock.calls[0][2].priority).toEqual([]);
  });
});

describe('세션 내 적응 — 같은 검사 안에서 눈높이가 움직인다', () => {
  /** 요청받은 레벨을 이름에 박아 돌려주는 말운동 추출기. */
  function 기록추출기() {
    const calls: Array<number | undefined> = [];
    const pick = (count: number, level?: number): QabDdkItem[] => {
      calls.push(level);
      return Array.from({ length: count }, (_, i) => ({
        itemId: `ddk_L${level ?? 'x'}_${i}`,
        syllable: '퍼',
        label: '퍼',
        targetCount: 10,
        instruction: 'x',
        presentedLevel: level,
      }));
    };
    return { calls, pick };
  }

  function 말운동세션(pick: (c: number, l?: number) => QabDdkItem[]) {
    return renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({
          getSkillLevels: vi
            .fn()
            .mockResolvedValue({ levels: { ddk: 3 }, manifestVersion: 1 }),
        }),
        generateSessionToken: () => 'tok-1',
        ...ISOLATED,
        pickWordItems: () => [],
        dailyCount: 0,
        wordCount: 0,
        pickDdkItems: pick,
        ddkCount: 3,
      }),
    );
  }

  type 세션 = ReturnType<typeof 말운동세션>['result'];

  /** 지금 문항을 틀리고 다음으로 넘어간다(감지 0회 = 목표 미달). */
  async function 틀리고넘기기(result: 세션) {
    act(() => result.current[1].submitDdk(0));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());
  }

  it('2연속 오답이면 남은 문항을 한 칸 내려 다시 뽑는다', async () => {
    const { calls, pick } = 기록추출기();
    const { result } = 말운동세션(pick);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 세션 시작: 서버 레벨 3으로 3문항
    expect(calls).toEqual([3]);
    // 문항 순서는 섞이므로 인덱스가 아니라 **레벨**만 본다.
    expect(result.current[0].currentItem?.id).toMatch(/^ddk_L3_/);

    await 틀리고넘기기(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    // 한 번 틀린 것으로는 안 움직인다 — 한 문항은 컨디션일 수 있다.
    expect(calls).toEqual([3]);

    await 틀리고넘기기(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 두 번째 오답에서 규칙이 걸려 남은 1문항을 레벨 2로 다시 뽑는다.
    expect(calls).toEqual([3, 2]);
    expect(result.current[0].currentItem?.id).toMatch(/^ddk_L2_/);
  });

  it('이미 푼 문항과 지금 화면의 문항은 건드리지 않는다', async () => {
    // 답하는 도중에 문제가 바뀌면 환자에게는 앱이 고장 난 것으로 보인다.
    const { pick } = 기록추출기();
    const { result } = 말운동세션(pick);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    await 틀리고넘기기(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    const 두번째 = result.current[0].currentItem?.id;

    act(() => result.current[1].submitDdk(0));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    // 규칙이 걸린 직후에도 화면의 문항은 그대로다.
    expect(result.current[0].currentItem?.id).toBe(두번째);
  });

  it('보호자가 넘긴 문항(도움받음)은 적응 판정에 세지 않는다', async () => {
    // 환자가 맞힌 게 아니라 보호자가 통과시킨 것이다. 세면 연속 정답이 채워져
    // 못 푸는 레벨로 올라간다.
    const { calls, pick } = 기록추출기();
    const { result } = 말운동세션(pick);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    await 틀리고넘기기(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 두 번째는 보호자가 넘긴다 → 오답 연속이 끊기지도, 정답으로 세지지도 않는다.
    act(() => result.current[1].skipCurrent());
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    expect(calls).toEqual([3]);
  });

  it('서버 레벨을 못 받으면 적응하지 않는다 — 기준점이 없다', async () => {
    const calls: Array<number | undefined> = [];
    const { result } = renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({
          getSkillLevels: vi.fn().mockRejectedValue(new Error('down')),
        }),
        generateSessionToken: () => 'tok-1',
        ...ISOLATED,
        pickWordItems: () => [],
        dailyCount: 0,
        wordCount: 0,
        pickDdkItems: (count: number, level?: number) => {
          calls.push(level);
          return Array.from({ length: count }, (_, i) => ({
            itemId: `ddk_x_${i}`,
            syllable: '퍼',
            label: '퍼',
            targetCount: 10,
            instruction: 'x',
          }));
        },
        ddkCount: 3,
      }),
    );
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    await 틀리고넘기기(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    await 틀리고넘기기(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    // 레벨 조회 실패는 비차단이고, 기준점이 없으면 조정도 없다.
    expect(calls).toEqual([undefined]);
  });
});

describe('보호자 넘어가기는 환자 수행이 아니다 (E12)', () => {
  /** 이름대기 N문항짜리 세션. 넘어가기·오답을 섞어 넣기 좋다. */
  function 이름대기세션(n: number, submitQabResults = vi.fn().mockResolvedValue({ saved: 1 })) {
    const items: QabNamingItem[] = Array.from({ length: n }, (_, i) => ({
      itemId: `nm_${i}`,
      imageUrl: `/${i}.svg`,
      targetWord: '사과',
      instruction: 'x',
    }));
    return renderHook(() =>
      useMixedQuizSession(QUIZ_SET_ID, {
        quizApi: makeApi({ submitQabResults }),
        generateSessionToken: () => 'tok-1',
        ...ISOLATED,
        pickWordItems: () => [],
        dailyCount: 0,
        wordCount: 0,
        pickNamingItems: () => items,
        namingCount: n,
      }),
    );
  }

  type 세션 = ReturnType<typeof 이름대기세션>['result'];

  async function 넘긴다(result: 세션) {
    act(() => result.current[1].skipCurrent());
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());
  }

  async function 틀린다(result: 세션) {
    act(() => result.current[1].submitNaming('전혀다른말'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());
  }

  it('넘어간 문항은 점수의 분자·분모 어디에도 안 들어간다', async () => {
    // 정답으로 세면 100점까지 부풀고, 오답으로 세면 도움을 처벌하는 셈이 된다.
    const { result } = 이름대기세션(2);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    await 넘긴다(result); // 1문항: 보호자가 넘김
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    await 틀린다(result); // 2문항: 환자가 틀림 → 세션 끝

    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    // 환자가 푼 것은 1문항, 그중 정답 0 → 0점. (넘긴 문항이 정답으로 세였다면 50점)
    expect(result.current[0].sessionScore).toBe(0);
  });

  it('전부 넘기면 점수가 100점이 되지 않는다', async () => {
    const { result } = 이름대기세션(2);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    await 넘긴다(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    await 넘긴다(result);

    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    expect(result.current[0].sessionScore).not.toBe(100);
  });

  it('연속 오답 사이에 넘어가기가 끼어도 피로 탈출이 발동한다', async () => {
    // 예전에는 넘어가기가 true로 들어가 연속 카운터를 0으로 리셋했다. 즉
    // **힘들어서 넘긴 바로 그 상황에서** 안전장치가 꺼졌다.
    const { result } = 이름대기세션(6);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    await 틀린다(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    await 넘긴다(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    await 틀린다(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    await 틀린다(result);

    // 오답 3연속(중간의 넘어가기는 투명하게 지나친다) → 6문항을 다 풀기 전에 종료.
    await waitFor(() => expect(result.current[0].phase).toBe('result'));
  });

  it('넘어가기가 정답 뒤에 오면 그 정답을 지우지 않는다', async () => {
    // 투명하게 지나친다는 것은 연속을 끊지도, 잇지도 않는다는 뜻이다.
    const { result } = 이름대기세션(3);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    act(() => result.current[1].submitNaming('사과'));
    await waitFor(() => expect(result.current[0].phase).toBe('feedback'));
    act(() => result.current[1].next());
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));

    await 넘긴다(result);
    await waitFor(() => expect(result.current[0].phase).toBe('answering'));
    await 틀린다(result);

    await waitFor(() => expect(result.current[0].phase).toBe('result'));
    // 환자가 푼 것은 2문항(정답 1, 오답 1) → 50점.
    expect(result.current[0].sessionScore).toBe(50);
  });
});
