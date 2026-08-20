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
 * 초점은 세 가지다.
 *  - **재시도 루프** — 틀리면 판정 없이 다시 고르게 하고, 3번을 다 쓰면
 *    정답을 알려주고 끝낸다. 고른 선택지를 잠그지는 않는다 — 잠그면 마지막
 *    시도가 소거법이 되어 시도 간 비교가 깨진다.
 *  - **시도 축** — 한 문항이 최대 3행으로 남고, 앞 시도를 덮어쓰지 않는다.
 *    "몇 번 만에 됐는가"는 마지막 결과만 남기면 사라지는 정보다.
 *  - **점진 저장** — 중도 이탈해도 그때까지가 남고, 실패한 제출은 다음에
 *    다시 실린다.
 *
 * 훅이 문항을 섞으므로 어떤 테스트도 문항 순서를 가정하지 않는다 — 현재
 * 문항에서 식별자를 읽는다.
 *
 * 2026-08-20 이전에 있던 "오답과 정답이 상태로 구별되지 않는다"는 테스트는
 * 지웠다. 그 불변식을 의도적으로 뒤집었다(정답을 가르치기로 결정). 남은
 * 불변식은 "집계를 노출하지 않는다"이고, 그건 화면 테스트가 지킨다.
 */

/** 4지선다 — 오답 3개가 있어야 3번 틀리는 경로를 볼 수 있다. */
const imageItem = (id: string): QabImageItem => ({
  itemId: id,
  category: 'word',
  promptText: '사과',
  instruction: '고르세요',
  choices: [
    { choiceId: id + '_ok', label: '사과', imageUrl: '/a.png', isCorrect: true },
    { choiceId: id + '_n1', label: '배', imageUrl: '/b.png', isCorrect: false },
    { choiceId: id + '_n2', label: '감', imageUrl: '/c.png', isCorrect: false },
    { choiceId: id + '_n3', label: '귤', imageUrl: '/d.png', isCorrect: false },
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

  const currentId = (r: Rendered): string =>
    r.current[0].currentItem?.item.itemId ?? '';

  /** 지금 문항에 정답을 낸다. 문항 id를 돌려준다. */
  const answerCorrect = (r: Rendered): string => {
    const id = currentId(r);
    act(() => r.current[1].answer(id + '_ok'));
    return id;
  };

  /** 지금 문항에 n번째 오답을 낸다(n = 1..3). */
  const answerWrong = (r: Rendered, n: 1 | 2 | 3): string => {
    const id = currentId(r);
    act(() => r.current[1].answer(id + '_n' + String(n)));
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

  describe('재시도 루프', () => {
    it('틀리면 다시 고르게 한다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerWrong(result, 1);

      const [s] = result.current;
      expect(s.phase).toBe('answering');
      expect(s.attemptNo).toBe(2);
      expect(s.isSelectable).toBe(true);
      // 아직 정답을 알려줄 때가 아니다.
      expect(s.outcome).toBeNull();
      expect(s.correctAnswerLabel).toBeNull();
    });

    it('같은 오답을 다시 골라도 시도가 흘러간다', () => {
      // 선택지를 잠그지 않으므로 같은 것을 또 누를 수 있다. 그래도 시도는
      // 소모된다 — 무한히 머무르지 않는다.
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerWrong(result, 1);
      answerWrong(result, 1);
      expect(result.current[0].attemptNo).toBe(3);

      answerWrong(result, 1);
      expect(result.current[0].phase).toBe('revealed');
      expect(result.current[0].outcome).toBe('exhausted');
    });

    it('맞히면 정답을 알려주고 문항이 끝난다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerCorrect(result);

      const [s] = result.current;
      expect(s.phase).toBe('revealed');
      expect(s.outcome).toBe('correct');
      expect(s.correctAnswerLabel).toBe('사과');
      expect(s.isSelectable).toBe(false);
    });

    it('세 번 틀리면 정답을 알려주고 문항이 끝난다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerWrong(result, 1);
      answerWrong(result, 2);
      expect(result.current[0].attemptNo).toBe(3);

      answerWrong(result, 3);

      const [s] = result.current;
      expect(s.phase).toBe('revealed');
      expect(s.outcome).toBe('exhausted');
      // 3번 틀렸어도 정답을 본 채로 끝난다 — 틀린 연결이 굳는 것을 막는다.
      expect(s.correctAnswerLabel).toBe('사과');
      expect(s.isSelectable).toBe(false);
    });

    it('중간에 맞히면 남은 시도를 쓰지 않는다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerWrong(result, 1);
      answerCorrect(result);

      expect(result.current[0].phase).toBe('revealed');
      expect(result.current[0].outcome).toBe('correct');
    });

    it('정답이 공개된 뒤의 답은 무시된다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const id = answerCorrect(result);
      act(() => result.current[1].answer(id + '_n1'));

      expect(result.current[0].outcome).toBe('correct');
      expect(result.current[0].attemptNo).toBe(1);
    });

    it('다음 문항으로 가면 시도 번호가 초기화된다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerWrong(result, 1);
      answerCorrect(result);
      await goNext(result);

      const [s] = result.current;
      expect(s.attemptNo).toBe(1);
      expect(s.selectedValue).toBeNull();
      expect(s.outcome).toBeNull();
    });
  });

  describe('시도 축', () => {
    it('시도마다 한 행씩 남고 앞 시도를 덮어쓰지 않는다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const id = answerWrong(result, 1);
      answerWrong(result, 2);
      answerCorrect(result);
      await goNext(result);

      expect(submitted[0].results).toEqual([
        { itemKind: 'imageChoice', itemRef: id, attempt: 1, isCorrect: false, tier: 0 },
        { itemKind: 'imageChoice', itemRef: id, attempt: 2, isCorrect: false, tier: 0 },
        { itemKind: 'imageChoice', itemRef: id, attempt: 3, isCorrect: true, tier: 0 },
      ]);
    });

    it('세 번 다 틀린 문항은 실패 세 행으로 남는다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const id = answerWrong(result, 1);
      answerWrong(result, 2);
      answerWrong(result, 3);
      await goNext(result);

      const rows = submitted[0].results;
      expect(rows.map((r) => r.attempt)).toEqual([1, 2, 3]);
      expect(rows.every((r) => r.itemRef === id)).toBe(true);
      expect(rows.every((r) => r.isCorrect === false)).toBe(true);
    });
  });

  describe('진행', () => {
    it('넘어가기는 시도로 기록하지 않고 다음으로 간다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const skipped = currentId(result);

      act(() => result.current[1].skip());
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current[0].phase).toBe('answering');
      expect(result.current[0].currentIndex).toBe(1);
      // 넘어가기는 실패가 아니라 "막혔다"는 신호라 남길 값이 없다.
      expect(submitted.flatMap((x) => x.results)).toHaveLength(0);
      expect(currentId(result)).not.toBe(skipped);
    });

    it('틀린 뒤 넘어가면 그때까지의 시도는 남는다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const id = answerWrong(result, 1);
      act(() => result.current[1].skip());
      await act(async () => {
        await Promise.resolve();
      });

      expect(submitted.flatMap((x) => x.results)).toEqual([
        { itemKind: 'imageChoice', itemRef: id, attempt: 1, isCorrect: false, tier: 0 },
      ]);
    });

    it('정답 공개 중에는 넘어가기가 먹지 않는다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerCorrect(result);
      act(() => result.current[1].skip());

      expect(result.current[0].phase).toBe('revealed');
      expect(result.current[0].currentIndex).toBe(0);
    });

    it('마지막 문항을 넘기면 종료된다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      expect(result.current[0].totalCount).toBe(2);

      answerCorrect(result);
      await goNext(result);
      answerCorrect(result);
      await goNext(result);

      expect(result.current[0].phase).toBe('done');
      expect(result.current[0].currentItem).toBeNull();
    });
  });

  describe('점진 저장', () => {
    it('문항을 넘길 때마다 아직 안 보낸 tail만 보낸다', async () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      const first = answerCorrect(result);
      await goNext(result);
      expect(submitted).toHaveLength(1);
      expect(submitted[0].results.map((r) => r.itemRef)).toEqual([first]);

      const second = answerCorrect(result);
      await goNext(result);
      expect(submitted).toHaveLength(2);
      // 두 번째 제출에 첫 문항이 다시 들어가면 안 된다.
      expect(submitted[1].results.map((r) => r.itemRef)).toEqual([second]);
    });

    it('중간에 그만둬도 그때까지가 저장된다', () => {
      const { result } = renderHook(() => usePracticeSession(deps()));
      answerWrong(result, 1);
      act(() => result.current[1].endSession());

      expect(result.current[0].phase).toBe('done');
      expect(submitted.flatMap((s) => s.results)).toHaveLength(1);
    });

    it('답한 뒤 next 없이 화면을 떠나도 저장된다', () => {
      const { result, unmount } = renderHook(() => usePracticeSession(deps()));
      answerCorrect(result);
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
      const first = answerCorrect(result);
      await goNext(result);

      // 실패해도 다음 문항으로 넘어가 있다 — 저장은 환자 경험을 막지 않는다.
      expect(result.current[0].phase).toBe('answering');
      expect(submitted).toHaveLength(0);

      const second = answerCorrect(result);
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
      answerCorrect(result);
      await goNext(result);
      answerCorrect(result);
      await goNext(result);

      expect(submitted.map((x) => x.token)).toEqual(['tok-1', 'tok-1']);
    });
  });
});
