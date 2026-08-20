// 연습 세션 훅 (Tier 0 — 터치 전용)
//
// **검사 훅(useMixedQuizSession)을 재사용하지 않는 이유.**
//
// 겉보기엔 둘 다 "문항을 순서대로 내고 답을 받아 저장"이라 합칠 수 있어 보인다.
// 세 가지가 다르다.
//
//  1. 저장소가 다르다 — 연습 결과가 qab_results로 흘러들면 세션당 40문항이
//     검사 13문항을 3:1로 압도해 연습 성적이 곧 환자의 측정값이 된다.
//  2. 판정을 안 보여준다 — 검사 훅의 'feedback' 단계와 lastResult는 정오답을
//     드러내기 위한 것이다. 연습엔 그 단계가 없어야 한다.
//  3. 나중에 단서 층이 들어온다 — 한 문항 안에서 "발화 → 막히면 단서 → 재시도"가
//     돌아야 하는데, 검사 훅의 answerAgain은 앞 시도를 pop으로 지운다
//     (검사는 한 문항 한 결과가 옳으므로 그게 맞다).
//
// 억지로 합치면 위 셋이 전부 조건 분기가 되고, 그 분기 하나를 잘못 타는 순간
// 오염이 조용히 일어난다.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pickQabItems,
  pickSpellItems,
} from '../../quiz/infrastructure/QabItemBank.js';
import type { PracticeAttemptInput, PracticePlayable } from '../domain/Practice.js';
import {
  itemRefOf,
  scorePracticeAnswer,
  tierForKind,
} from '../domain/practiceScoring.js';
import { practiceApi, type IPracticeApi } from '../infrastructure/PracticeApi.js';

export type PracticePhase = 'answering' | 'answered' | 'done';

export interface UsePracticeState {
  phase: PracticePhase;
  currentItem: PracticePlayable | null;
  currentIndex: number;
  totalCount: number;
  /** 방금 고른 선택지(UI가 눌린 상태를 유지하기 위한 값). 정답 여부가 아니다. */
  selectedValue: string | null;
  /** 선택 가능 여부 — 답한 뒤 next() 전까지 잠근다(중복 제출 방지). */
  isSelectable: boolean;
}

export interface UsePracticeActions {
  /** 답을 낸다. 채점은 하되 **결과를 상태에 노출하지 않는다.** */
  answer: (value: string) => void;
  /** 다음 문항으로. 마지막이면 종료. */
  next: () => void;
  /** 중간에 그만둔다(보호자/환자). 지금까지의 결과는 저장된다. */
  endSession: () => void;
}

export type UsePracticeReturn = [UsePracticeState, UsePracticeActions];

export interface UsePracticeDeps {
  practiceApi?: IPracticeApi;
  pickQabItems?: typeof pickQabItems;
  pickSpellItems?: typeof pickSpellItems;
  generateSessionToken?: () => string;
  imageChoiceCount?: number;
  spellCount?: number;
}

// 걸어다니는 뼈대의 기본 구성. 총량은 궁극적으로 보호자가 정하고 구성비는
// 레벨이 정하지만(설계 §세션 길이), 그 배선은 후속 작업이다.
const DEFAULT_IMAGE_CHOICE_COUNT = 6;
const DEFAULT_SPELL_COUNT = 2;

function defaultGenerateToken(): string {
  return crypto.randomUUID();
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function usePracticeSession(
  deps?: UsePracticeDeps,
): UsePracticeReturn {
  const apiRef = useRef<IPracticeApi>(deps?.practiceApi ?? practiceApi);

  // 세션 토큰과 문항 목록은 마운트 시 한 번 정해지고 이후 바뀌지 않는다.
  // ref에 렌더 중 대입하면 React가 렌더를 재실행할 때 값이 흔들릴 수 있어,
  // 지연 초기화 useState로 잡는다(생성기도 첫 렌더에서 한 번만 불린다).
  const [sessionToken] = useState<string>(
    () => (deps?.generateSessionToken ?? defaultGenerateToken)(),
  );

  // 문항은 전부 로컬 뱅크에서 조립한다 — Tier 0의 콘텐츠 비용이 0인 이유다.
  const [items] = useState<PracticePlayable[]>(() => {
    const pickImage = deps?.pickQabItems ?? pickQabItems;
    const pickSpell = deps?.pickSpellItems ?? pickSpellItems;
    const imageItems: PracticePlayable[] = pickImage(
      deps?.imageChoiceCount ?? DEFAULT_IMAGE_CHOICE_COUNT,
    ).map((item) => ({ kind: 'imageChoice' as const, id: item.itemId, item }));
    const spellItems: PracticePlayable[] = pickSpell(
      deps?.spellCount ?? DEFAULT_SPELL_COUNT,
    ).map((item) => ({ kind: 'spell' as const, id: item.itemId, item }));
    return shuffle([...imageItems, ...spellItems]);
  });

  const indexRef = useRef(0);
  /**
   * 화면에 그려지는 phase와 별개로 두는 즉시 반영본.
   *
   * setState는 다음 렌더에야 반영되므로, 답을 아주 빨리 두 번 누르면 두 번째가
   * 아직 'answering'인 state를 보고 통과해버린다. 가드는 이 ref로 한다.
   */
  const phaseRef = useRef<PracticePhase>(
    items.length > 0 ? 'answering' : 'done',
  );
  /** 쌓인 시도 전부. 아직 안 보낸 tail은 submittedCount 이후다. */
  const attemptsRef = useRef<PracticeAttemptInput[]>([]);
  const submittedCountRef = useRef(0);

  const [state, setState] = useState<UsePracticeState>(() => ({
    phase: items.length > 0 ? 'answering' : 'done',
    currentItem: items[0] ?? null,
    currentIndex: 0,
    totalCount: items.length,
    selectedValue: null,
    isSelectable: items.length > 0,
  }));

  // 점진 제출: 문항을 넘길 때마다 아직 안 보낸 tail만 보낸다. 세션 끝 1회가
  // 아니라서, 어르신이 중도에 그만둬도 그때까지가 남는다. 실패는 비차단 —
  // submittedCount를 안 올리므로 다음 flush에서 재시도되고, 서버는
  // (session, item, attempt) UNIQUE + ON CONFLICT DO NOTHING으로 멱등이다.
  //
  // 완료 마커는 보내지 않는다. 검사와 달리 연습은 중간에 끊는 것이 정상
  // 사용이라, 완료/이탈을 구분하면 "포기율"이라는 없는 개념이 생긴다.
  const flushPending = useCallback((): void => {
    const all = attemptsRef.current;
    const pending = all.slice(submittedCountRef.current);
    if (pending.length === 0) return;
    const target = all.length;
    void Promise.resolve(apiRef.current.submitResults(sessionToken, pending))
      .then(() => {
        submittedCountRef.current = target;
      })
      .catch((err: unknown) => {
        console.warn('[practice] 연습 결과 저장 실패:', err);
      });
  }, [sessionToken]);

  const answer = useCallback((value: string): void => {
    if (phaseRef.current !== 'answering') return;
    const playable = items[indexRef.current];
    if (!playable) return;

    // 채점은 하되 결과를 상태에 넣지 않는다. 연습 중엔 판정을 안 보여준다 —
    // 여기서 lastResult 같은 걸 두는 순간 화면이 그걸 그리게 된다.
    const isCorrect = scorePracticeAnswer(playable, value);
    attemptsRef.current.push({
      itemKind: playable.kind,
      itemRef: itemRefOf(playable),
      attempt: 1,
      isCorrect,
      tier: tierForKind(playable.kind),
    });

    phaseRef.current = 'answered';
    setState((prev) => ({
      ...prev,
      phase: 'answered',
      selectedValue: value,
      isSelectable: false,
    }));
  }, [items]);

  const next = useCallback((): void => {
    if (phaseRef.current !== 'answered') return;
    flushPending();

    const nextIndex = indexRef.current + 1;
    if (nextIndex >= items.length) {
      phaseRef.current = 'done';
      setState((prev) => ({
        ...prev,
        phase: 'done',
        currentItem: null,
        isSelectable: false,
      }));
      return;
    }

    indexRef.current = nextIndex;
    phaseRef.current = 'answering';
    setState((prev) => ({
      ...prev,
      phase: 'answering',
      currentIndex: nextIndex,
      currentItem: items[nextIndex],
      selectedValue: null,
      isSelectable: true,
    }));
  }, [flushPending, items]);

  const endSession = useCallback((): void => {
    if (phaseRef.current === 'done') return;
    flushPending();
    phaseRef.current = 'done';
    setState((prev) => ({
      ...prev,
      phase: 'done',
      currentItem: null,
      isSelectable: false,
    }));
  }, [flushPending]);

  // 화면 이탈 시 마지막으로 답한(아직 next 안 누른) 문항도 저장한다.
  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  return [state, { answer, next, endSession }];
}
