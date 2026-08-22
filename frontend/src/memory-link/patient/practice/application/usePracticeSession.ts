// 연습 세션 훅 (Tier 0 — 터치 전용)
//
// **검사 훅(useMixedQuizSession)을 재사용하지 않는 이유.**
//
// 겉보기엔 둘 다 "문항을 순서대로 내고 답을 받아 저장"이라 합칠 수 있어 보인다.
// 세 가지가 다르다.
//
//  1. 저장소가 다르다 — 연습 결과가 qab_results로 흘러들면 세션당 40문항이
//     검사 13문항을 3:1로 압도해 연습 성적이 곧 환자의 측정값이 된다.
//  2. 시도 축이 있다 — 한 문항이 최대 3행으로 남는다. 검사 훅의 answerAgain은
//     앞 시도를 pop으로 지운다(검사는 한 문항 한 결과가 옳으므로 그게 맞다).
//  3. 판정의 쓰임이 다르다 — 검사는 채점하려고, 연습은 가르치려고 한다.
//
// 억지로 합치면 위 셋이 전부 조건 분기가 되고, 그 분기 하나를 잘못 타는 순간
// 오염이 조용히 일어난다.
//
// **2026-08-20 — 판정을 화면에 드러내기로 뒤집었다.**
// 이전 설계는 "연습 중엔 판정을 전혀 안 보여준다"였다. 그 근거였던 오염 논리는
// **결과가 어디에 저장되는가**에 대한 것이지 화면에 무엇이 그려지는가와는
// 무관하다는 것이 분명해졌다. 시험이 되는 지점은 집계(점수·정답률)이지 문항별
// 안내가 아니다. 저장소 분리는 그대로다.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  masterWords,
  pickSentItems,
  pickSpellItems,
  pickWordItems,
} from '../../quiz/infrastructure/QabItemBank.js';
import type { QabImageItem } from '../../quiz/domain/MixedQuiz.js';
import type { PracticeAttemptInput, PracticePlayable } from '../domain/Practice.js';
import {
  MAX_PRACTICE_ATTEMPTS,
  allowsRetry,
  correctAnswerLabelOf,
  itemRefOf,
  scorePracticeAnswer,
  tierForKind,
} from '../domain/practiceScoring.js';
import {
  PRACTICE_SENTENCE_COUNT,
  practiceLevelFor,
} from '../domain/practiceDifficulty.js';
import { buildOddOneOutItems } from '../domain/practiceOddOneOut.js';
import { toWordChoiceItem } from '../domain/practiceWordChoice.js';
import { practiceApi, type IPracticeApi } from '../infrastructure/PracticeApi.js';

export type PracticePhase = 'answering' | 'revealed' | 'done';

/**
 * 문항이 끝난 방식.
 *
 * 어느 쪽이든 **정답을 본 채로** 끝난다. 다른 것은 문구뿐이다
 * ("맞아요, 사과예요" / "이건 사과예요").
 */
export type PracticeOutcome = 'correct' | 'exhausted';

export interface UsePracticeState {
  phase: PracticePhase;
  currentItem: PracticePlayable | null;
  currentIndex: number;
  totalCount: number;
  /** 현재 시도 번호(1부터). 재시도할 때마다 오른다. */
  attemptNo: number;
  /** 최근에 고른 값. 정답 여부가 아니라 "무엇을 눌렀는가"다. */
  selectedValue: string | null;
  /** 선택 가능 여부 — 정답 공개 뒤 next() 전까지 잠근다. */
  isSelectable: boolean;
  /** phase가 'revealed'일 때만 값이 있다. */
  outcome: PracticeOutcome | null;
  /** phase가 'revealed'일 때만 값이 있다. 화면이 말로 알려줄 정답. */
  correctAnswerLabel: string | null;
}

export interface UsePracticeActions {
  /**
   * 답을 낸다.
   *
   * 맞으면 정답을 확인해주고 끝난다. 틀리면 판정 없이 다시 고르게 한다.
   * {@link MAX_PRACTICE_ATTEMPTS}번을 다 쓰면 정답을 알려주고 끝난다.
   */
  answer: (value: string) => void;
  /**
   * 이 문항을 건너뛴다.
   *
   * **넘어가기 자체는 시도로 기록하지 않는다.** 실패가 아니라 "막혔다"는
   * 신호다. isCorrect: false로 남기면 연습이 실패 기록이 되고, null로 남기면
   * Tier 1(채점 안 함)과 구별되지 않는다. 어느 쪽도 사실이 아니다.
   * (앞서 틀린 시도가 있었다면 그 행들은 이미 남아 있다.)
   *
   * 단서 층이 들어오면 이 버튼이 곧 단서 트리거가 된다(설계 §트리거 C).
   */
  skip: () => void;
  /** 정답을 본 뒤 다음 문항으로. 마지막이면 종료. */
  next: () => void;
  /** 중간에 그만둔다(보호자/환자). 지금까지의 결과는 저장된다. */
  endSession: () => void;
}

export type UsePracticeReturn = [UsePracticeState, UsePracticeActions];

export interface UsePracticeDeps {
  practiceApi?: IPracticeApi;
  pickWordItems?: typeof pickWordItems;
  pickSentItems?: typeof pickSentItems;
  pickSpellItems?: typeof pickSpellItems;
  generateSessionToken?: () => string;
  imageChoiceCount?: number;
  /** 낱말고르기(그림 보고 낱말 고르기) 문항 수. */
  wordChoiceCount?: number;
  /** 무리에서 빼기 문항 수. */
  oddOneOutCount?: number;
  masterWords?: typeof masterWords;
  /** 문장이해 문항 수. 기본 0 — 이유는 practiceDifficulty.ts 참고. */
  sentenceCount?: number;
  spellCount?: number;
  /** 검사 레벨(있으면). 연습 상한을 넘으면 상한으로 깎인다. */
  examLevel?: number;
}

// 걸어다니는 뼈대의 기본 구성. 총량은 궁극적으로 보호자가 정하고 구성비는
// 레벨이 정하지만(설계 §세션 길이), 그 배선은 후속 작업이다.
const DEFAULT_IMAGE_CHOICE_COUNT = 3;
const DEFAULT_WORD_CHOICE_COUNT = 2;
const DEFAULT_ODD_ONE_OUT_COUNT = 2;
const DEFAULT_SPELL_COUNT = 1;

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
  //
  // **뱅크는 검사와 공유하되 뽑는 규칙은 공유하지 않는다.** 이전에는
  // pickQabItems(count)를 인자 없이 불러 검사 기본값을 그대로 받았고, 그래서
  // 연습 첫 화면에 역행 문장 변별이 나왔다(TODO-113). 지금은 레벨을 명시하고
  // 문장은 종류를 골라 넣을 수 있을 때까지 뺀다.
  const [items] = useState<PracticePlayable[]>(() => {
    const pickWord = deps?.pickWordItems ?? pickWordItems;
    const pickSent = deps?.pickSentItems ?? pickSentItems;
    const pickSpell = deps?.pickSpellItems ?? pickSpellItems;
    const level = practiceLevelFor(deps?.examLevel);

    const toImageChoice = (item: QabImageItem): PracticePlayable => ({
      kind: 'imageChoice',
      id: item.itemId,
      item,
    });

    // 낱말 문항을 한 번에 뽑아 두 양식으로 나눈다. 따로 뽑으면 같은 낱말이
    // 한 세션에 두 양식으로 나올 수 있는데, 반복 훈련으로는 오히려 맞는 일이나
    // 어르신에게는 "아까 그거 또 나왔네"로 읽힌다. 나누는 편을 먼저 둔다.
    const imageCount = deps?.imageChoiceCount ?? DEFAULT_IMAGE_CHOICE_COUNT;
    const wordChoiceCount = deps?.wordChoiceCount ?? DEFAULT_WORD_CHOICE_COUNT;
    const wordPool = pickWord(imageCount + wordChoiceCount, level);

    const wordItems = wordPool.slice(0, imageCount).map(toImageChoice);
    const wordChoiceItems: PracticePlayable[] = wordPool
      .slice(imageCount)
      .map(toWordChoiceItem)
      // 문장 문항은 뒤집을 수 없어 null로 온다. 뱅크가 낱말만 주지만
      // 조용히 이상한 문항이 서느니 여기서 떨군다.
      .filter((item) => item !== null)
      .map((item) => ({ kind: 'wordChoice' as const, id: item.itemId, item }));
    const sentItems = pickSent(
      deps?.sentenceCount ?? PRACTICE_SENTENCE_COUNT,
      level,
    ).map(toImageChoice);
    const oddOneOutItems: PracticePlayable[] = buildOddOneOutItems(
      (deps?.masterWords ?? masterWords)(),
      deps?.oddOneOutCount ?? DEFAULT_ODD_ONE_OUT_COUNT,
    ).map((item) => ({ kind: 'oddOneOut' as const, id: item.itemId, item }));
    const spellItems: PracticePlayable[] = pickSpell(
      deps?.spellCount ?? DEFAULT_SPELL_COUNT,
    ).map((item) => ({ kind: 'spell' as const, id: item.itemId, item }));
    return shuffle([
      ...wordItems,
      ...wordChoiceItems,
      ...oddOneOutItems,
      ...sentItems,
      ...spellItems,
    ]);
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
  /** 같은 이유로 시도 번호도 ref가 진실이다. */
  const attemptRef = useRef(1);
  /** 쌓인 시도 전부. 아직 안 보낸 tail은 submittedCount 이후다. */
  const attemptsRef = useRef<PracticeAttemptInput[]>([]);
  const submittedCountRef = useRef(0);

  const [state, setState] = useState<UsePracticeState>(() => ({
    phase: items.length > 0 ? 'answering' : 'done',
    currentItem: items[0] ?? null,
    currentIndex: 0,
    totalCount: items.length,
    attemptNo: 1,
    selectedValue: null,
    isSelectable: items.length > 0,
    outcome: null,
    correctAnswerLabel: null,
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

    const attempt = attemptRef.current;
    const isCorrect = scorePracticeAnswer(playable, value);

    // 시도마다 한 행. 앞 시도를 덮어쓰지 않는다 — "몇 번 만에 됐는가"가
    // 단서 반응성의 前身이고, 그건 마지막 결과만 남기면 사라지는 정보다.
    attemptsRef.current.push({
      itemKind: playable.kind,
      itemRef: itemRefOf(playable),
      attempt,
      isCorrect,
      tier: tierForKind(playable.kind),
    });

    const canRetry =
      !isCorrect && allowsRetry(playable) && attempt < MAX_PRACTICE_ATTEMPTS;

    if (canRetry) {
      // 고른 오답을 잠그지 않는다. 4지선다에서 둘을 잠그면 3차 시도가
      // 소거법이 되어 우연 정답률 바닥이 25%에서 50%로 뛴다. "몇 번 만에
      // 됐는가"를 단서 반응성으로 읽으려면 매 시도가 같은 조건이어야 한다.
      // 눌렸다는 신호는 시도마다 바뀌는 안내 문구가 대신한다.
      attemptRef.current = attempt + 1;
      setState((prev) => ({
        ...prev,
        attemptNo: attempt + 1,
        selectedValue: null,
        isSelectable: true,
        outcome: null,
        correctAnswerLabel: null,
      }));
      return;
    }

    // 맞혔거나 시도를 다 썼다. 어느 쪽이든 **정답을 본 채로** 끝난다.
    phaseRef.current = 'revealed';
    setState((prev) => ({
      ...prev,
      phase: 'revealed',
      selectedValue: value,
      isSelectable: false,
      outcome: isCorrect ? 'correct' : 'exhausted',
      correctAnswerLabel: correctAnswerLabelOf(playable),
    }));
  }, [items]);

  /** 다음 문항으로 이동하거나 세션을 끝낸다. next/skip이 공유한다. */
  const advance = useCallback((): void => {
    flushPending();

    const nextIndex = indexRef.current + 1;
    if (nextIndex >= items.length) {
      phaseRef.current = 'done';
      setState((prev) => ({
        ...prev,
        phase: 'done',
        currentItem: null,
        isSelectable: false,
        outcome: null,
        correctAnswerLabel: null,
      }));
      return;
    }

    indexRef.current = nextIndex;
    attemptRef.current = 1;
    phaseRef.current = 'answering';
    setState((prev) => ({
      ...prev,
      phase: 'answering',
      currentIndex: nextIndex,
      currentItem: items[nextIndex],
      attemptNo: 1,
      selectedValue: null,
      isSelectable: true,
      outcome: null,
      correctAnswerLabel: null,
    }));
  }, [flushPending, items]);

  const next = useCallback((): void => {
    if (phaseRef.current !== 'revealed') return;
    advance();
  }, [advance]);

  const skip = useCallback((): void => {
    if (phaseRef.current !== 'answering') return;
    advance();
  }, [advance]);

  const endSession = useCallback((): void => {
    if (phaseRef.current === 'done') return;
    flushPending();
    phaseRef.current = 'done';
    setState((prev) => ({
      ...prev,
      phase: 'done',
      currentItem: null,
      isSelectable: false,
      outcome: null,
      correctAnswerLabel: null,
    }));
  }, [flushPending]);

  // 화면 이탈 시 마지막 시도(아직 next 안 누른 것)도 저장한다.
  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  return [state, { answer, skip, next, endSession }];
}
