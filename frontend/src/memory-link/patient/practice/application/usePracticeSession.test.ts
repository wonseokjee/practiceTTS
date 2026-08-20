import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QabImageItem, QabSpellItem } from '../../quiz/domain/MixedQuiz.js';
import type { PracticeAttemptInput } from '../domain/Practice.js';
import {
  usePracticeSession,
  type UsePracticeDeps,
  type UsePracticeReturn,
} from './usePracticeSession.js';

/**
 * 연습 세션 훅 테스트.
 *
 * 초점은 두 가지다.
 *  - **판정이 상태로 새지 않는가** — 연습 중엔 정오답을 안 보여준다. 채점은
 *    하되 화면이 그릴 수 있는 형태로 노출되면 안 된다.
 *  - **점진 저장이 tail만 보내는가** — 중도 이탈해도 그때까지가 남아야 하고,
 *    실패한 제출은 다음번에 다시 실려야 한다.
 *
 * 훅이 문항을 섞으므로 어떤 테스트도 문항 순서를 가정하지 않는다 — 현재
 * 문항에서 식별자를 읽는다.
 */

const imageItem = (id: string): QabImageItem => ({
  itemId: id,
  category: 'word',
  promptText: '사과',
  instruction: '고르세요',
  choices: [
    { choiceId: id + '_ok', label: '사과', imageUrl: '/a.png', isCorrect: true },
    { choiceId: id + '_no', label: '배', imageUrl: '/b.png', isCorrect: false },
  ],
});

const spellItem = (id: string): QabSpellItem => ({
  itemId: id,
  targetWord: '사과',
  imageUrl: '/a.png',
  tiles: ['사', '과'],
  instruction: '만드세요',
});

type SubmitFn = (
  token: string,
  results: PracticeAttemptInput[],
) => Promise<{ saved: number }>;

describe('usePracticeSession', () => {
  let submitted: { token: string; results: PracticeAttemptInput[] }[];
  let submitResults: SubmitFn;

  const deps = (over?: Partial<UsePracticeDeps>): UsePracticeDeps => ({
    practiceApi: { submitResults: (t, r) => submitResults(t, r) },
    // 뱅크를 고정해 조립을 결정론적으로 만든다(순서는 여전히 섞인다).
    pickQabItems: ((n: number) =>
      Array.from({ length: n }, (_, i) =>
        imageItem('img_' + String(i)),
      )) as UsePracticeDeps['pickQabItems'],
    pickSpellItems: ((n: number) =>
      Array.from({ length: n }, (_, i) =>
        spellItem('sp_' + String(i)),
      )) as UsePracticeDeps['pickSpellItems'],
    generateSessionToken: () => 'tok-1',
    imageChoiceCount: 2,
    spellCount: 0,
    ...over,
  });

  beforeEach(() => {
    submitted = [];
    submitResults = (token, results) => {
      submitted.push({ token, results: [...results] });
      return Promise.resolve({ saved: results.length });
    };
  });

  type Rendered = { current: UsePracticeReturn };

  /** 지금 문항에 답한다. 답한 문항의 itemRef를 돌려준다. */
  const answerCurrent = (r: Rendered, correct: boolean): string => {
    const id = r.current[0].currentItem?.item.itemId ?? '';
    act(() => r.current[1].answer(id + (correct ? '_ok' : '_no')));
    return id;
  };

  /**
   * 다음 문항으로 넘기고 저장이 끝나기를 기다린다.
   *
   * flushPending은 성공 시 `.then()`에서 submittedCount를 올리므로, 마이크로태스크를
   * 비우지 않으면 다음 flush가 이미 보낸 것을 다시 보낸다. 실제로도 답이 아주 빠르면
   * 같은 일이 일어나지만 서버가 (session, item, attempt) UNIQUE로 멱등이라 무해하다 —
   * 여기서는 tail 경계를 정확히 보기 위해 기다린다.
   */
  const goNext = async (r: Rendered): Promise<void> => {
    act(() => r.current[1].next());
    await act(async () => {
      await Promise.resolve();
    });
  };

  describe('판정 미노출', () => {
    it('상태에 정오답을 담는 필드가 없다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerCurrent(result, true);

      // 검사 훅에는 lastResult(isCorrect·correctLabel·grade)가 있고 화면이 그걸
      // 그린다. 연습 상태에는 그런 자리가 아예 없어야 한다.
      expect(Object.keys(result.current[0]).sort()).toEqual([
        'currentIndex',
        'currentItem',
        'isSelectable',
        'phase',
        'selectedValue',
        'totalCount',
      ]);
    });

    it('오답을 골라도 정답을 고른 것과 상태가 구별되지 않는다', () => {
      // 훅마다 따로 섞으므로 1문항 세션으로 고정해야 같은 문항을 비교한다.
      const one = { imageChoiceCount: 1 };
      const a = renderHook(() => usePracticeSession(deps(one)));
      const b = renderHook(() => usePracticeSession(deps(one)));

      answerCurrent(a.result, true);
      answerCurrent(b.result, false);

      // 유일한 차이는 "무엇을 눌렀는가"뿐이어야 한다 — 그게 맞았는지가 아니라.
      const strip = (s: object): object => {
        const rest = { ...(s as Record<string, unknown>) };
        delete rest.selectedValue;
        return rest;
      };
      expect(strip(a.result.current[0])).toEqual(strip(b.result.current[0]));
    });
  });

  describe('진행', () => {
    it('답하면 잠기고, next로 다음 문항으로 간다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      expect(result.current[0].phase).toBe('answering');
      expect(result.current[0].totalCount).toBe(2);

      answerCurrent(result, true);
      expect(result.current[0].phase).toBe('answered');
      expect(result.current[0].isSelectable).toBe(false);

      await goNext(result);
      expect(result.current[0].phase).toBe('answering');
      expect(result.current[0].currentIndex).toBe(1);
      expect(result.current[0].selectedValue).toBeNull();
    });

    it('잠긴 동안의 중복 답은 무시된다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const first = answerCurrent(result, true);
      answerCurrent(result, false); // 잠긴 뒤의 두 번째 답 — 무시돼야 한다

      await goNext(result);
      const second = answerCurrent(result, true);
      await goNext(result);

      const refs = submitted.flatMap((s) => s.results).map((r) => r.itemRef);
      expect(refs).toEqual([first, second]);
    });

    it('넘어가기는 시도로 기록하지 않고 다음으로 간다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const skipped = result.current[0].currentItem?.item.itemId ?? '';

      act(() => result.current[1].skip());
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current[0].phase).toBe('answering');
      expect(result.current[0].currentIndex).toBe(1);
      // 넘어가기는 실패가 아니라 "막혔다"는 신호라 남길 값이 없다.
      expect(submitted.flatMap((x) => x.results)).toHaveLength(0);
      expect(result.current[0].currentItem?.item.itemId).not.toBe(skipped);
    });

    it('답한 뒤에는 넘어가기가 먹지 않는다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerCurrent(result, true);
      act(() => result.current[1].skip());

      // 이미 기록된 시도를 넘어가기로 무르는 경로는 없다.
      expect(result.current[0].phase).toBe('answered');
      expect(result.current[0].currentIndex).toBe(0);
    });

    it('마지막 문항을 넘기면 종료된다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerCurrent(result, true);
      await goNext(result);
      answerCurrent(result, true);
      await goNext(result);

      expect(result.current[0].phase).toBe('done');
      expect(result.current[0].currentItem).toBeNull();
    });
  });

  describe('점진 저장', () => {
    it('문항을 넘길 때마다 아직 안 보낸 tail만 보낸다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const first = answerCurrent(result, true);
      await goNext(result);
      expect(submitted).toHaveLength(1);
      expect(submitted[0].results.map((r) => r.itemRef)).toEqual([first]);

      const second = answerCurrent(result, false);
      await goNext(result);
      expect(submitted).toHaveLength(2);
      // 두 번째 제출에 첫 문항이 다시 들어가면 안 된다.
      expect(submitted[1].results.map((r) => r.itemRef)).toEqual([second]);
    });

    it('시도에 tier와 attempt가 실린다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const ref = answerCurrent(result, true);
      await goNext(result);

      expect(submitted[0].results[0]).toEqual({
        itemKind: 'imageChoice',
        itemRef: ref,
        attempt: 1,
        isCorrect: true,
        tier: 0,
      });
    });

    it('중간에 그만둬도 그때까지가 저장된다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerCurrent(result, false);
      act(() => result.current[1].endSession());

      expect(result.current[0].phase).toBe('done');
      expect(submitted.flatMap((s) => s.results)).toHaveLength(1);
    });

    it('답한 뒤 next 없이 화면을 떠나도 저장된다', () => {
      const { result, unmount } = renderHook(() => usePracticeSession(deps()));
      answerCurrent(result, true);
      expect(submitted).toHaveLength(0);

      unmount();
      expect(submitted.flatMap((s) => s.results)).toHaveLength(1);
    });

    it('저장 실패는 연습을 막지 않고, 다음 flush에서 함께 재시도된다', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      let calls = 0;
      submitResults = (token, results) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('네트워크'));
        submitted.push({ token, results: [...results] });
        return Promise.resolve({ saved: results.length });
      };

      const { result } = renderHook(() => usePracticeSession(deps()));
      const first = answerCurrent(result, true);
      await goNext(result);

      // 실패해도 다음 문항으로 넘어가 있다 — 저장은 환자 경험을 막지 않는다.
      expect(result.current[0].phase).toBe('answering');
      expect(submitted).toHaveLength(0);

      const second = answerCurrent(result, true);
      await goNext(result);

      // submittedCount를 안 올렸으므로 실패한 첫 문항이 함께 다시 실린다.
      expect(submitted[0].results.map((r) => r.itemRef)).toEqual([
        first,
        second,
      ]);
      warn.mockRestore();
    });
  });

  describe('세션 토큰', () => {
    it('한 세션의 모든 제출이 같은 토큰을 쓴다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerCurrent(result, true);
      await goNext(result);
      answerCurrent(result, true);
      await goNext(result);

      expect(submitted.map((x) => x.token)).toEqual(['tok-1', 'tok-1']);
    });
  });
});
