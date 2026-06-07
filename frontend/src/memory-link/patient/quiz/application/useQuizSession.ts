// 퀴즈 풀이 FSM 훅 (Plan §3, §9-3)
//
// FSM:
//   idle → loading_questions → ready
//   ready → answering(idx=0)
//   answering(idx) → submitting → feedback(idx)
//   feedback(idx)       → answering(idx+1)   (idx < lastIdx)
//   feedback(lastIdx)   → submitting_final → result   (서버 completed=true 기준)
//   any → error (retry/restart 가능)
//
// 제출 전략(Plan §1): 같은 sessionToken을 세트 내내 재사용하며
// 문제마다 answers 1개로 POST → 즉시 채점 결과 표시.
// 마지막 문제 응답의 completed=true / bestScore / isNewBest로 결과 화면 전환.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AttemptResult,
  QuizQuestionPublic,
  QuizSetDetail,
} from '../domain/Quiz.js';
import { quizApi } from '../infrastructure/QuizApi.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';
import { toQuizErrorInfo } from './quizError.js';

/** FSM 단계 */
export type QuizSessionPhase =
  | 'idle'
  | 'loading_questions'
  | 'answering'
  | 'submitting'
  | 'feedback'
  | 'submitting_final'
  | 'result'
  | 'error';

export interface UseQuizSessionState {
  phase: QuizSessionPhase;
  /** 0-based 현재 문제 인덱스 */
  currentIndex: number;
  /** 전체 문제 수 */
  total: number;
  /** 현재 문제 (없으면 null) */
  currentQuestion: QuizQuestionPublic | null;
  /** 상세 로드된 세트 (사진 힌트 등 메타 참조용) */
  detail: QuizSetDetail | null;
  /** answering 단계에서만 true — 입력/선택 허용 여부 */
  isSelectable: boolean;
  /** 직전 제출 채점 결과 (feedback 단계에서 사용) */
  lastResult: AttemptResult | null;
  /** 마지막 제출이 반환한 세션 점수 (0..100) */
  sessionScore: number | null;
  /** 세트 완료 여부 */
  completed: boolean;
  /** 완료 시 역대 최고점 */
  bestScore: number | null;
  /** 완료 시 신기록 여부 */
  isNewBest: boolean;
  /** 사용자 친화 에러 메시지 */
  error: string | null;
  /** 세션 만료(410)로 인한 에러인지 — UI에서 "다시 시작" 유도 */
  isSessionExpired: boolean;
}

export interface UseQuizSessionActions {
  /** 현재 문제 답을 제출하고 즉시 채점 결과를 받는다 */
  selectAndSubmit: (userAnswer: string) => Promise<void>;
  /** 피드백 확인 후 다음 문제로 진행 (마지막이면 결과로) */
  next: () => void;
  /** 같은 세트를 처음부터 새 세션 토큰으로 다시 푼다 */
  retry: () => Promise<void>;
  /** retry의 별칭 — 결과 화면의 "다시 풀기" */
  restart: () => Promise<void>;
}

export type UseQuizSessionReturn = [
  UseQuizSessionState,
  UseQuizSessionActions,
];

/** 선택적 의존성 주입 (테스트 용이성) */
export interface UseQuizSessionDeps {
  quizApi?: IQuizApi;
  /** 세션 토큰 생성기 (테스트 시 고정값 주입 가능) */
  generateSessionToken?: () => string;
}

const INITIAL_STATE: UseQuizSessionState = Object.freeze({
  phase: 'idle',
  currentIndex: 0,
  total: 0,
  currentQuestion: null,
  detail: null,
  isSelectable: false,
  lastResult: null,
  sessionScore: null,
  completed: false,
  bestScore: null,
  isNewBest: false,
  error: null,
  isSessionExpired: false,
});

function defaultGenerateToken(): string {
  return crypto.randomUUID();
}

/** 문제를 orderIndex 오름차순으로 정렬 (서버 정렬을 신뢰하지 않고 보강) */
function sortQuestions(questions: QuizQuestionPublic[]): QuizQuestionPublic[] {
  return [...questions].sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * 퀴즈 풀이 세션 훅.
 *
 * @param quizSetId 풀 퀴즈 세트 ID
 * @param deps      테스트 시 의존성 주입 (선택)
 */
export function useQuizSession(
  quizSetId: string,
  deps?: UseQuizSessionDeps,
): UseQuizSessionReturn {
  const apiRef = useRef<IQuizApi>(deps?.quizApi ?? quizApi);
  const tokenGenRef = useRef<() => string>(
    deps?.generateSessionToken ?? defaultGenerateToken,
  );

  const [state, setState] = useState<UseQuizSessionState>({ ...INITIAL_STATE });

  // 세션 토큰과 정렬된 문제 목록은 렌더 사이에 안정적으로 유지한다.
  const sessionTokenRef = useRef<string>('');
  const questionsRef = useRef<QuizQuestionPublic[]>([]);

  // 제어 흐름용 ref 미러 — 이벤트 핸들러에서 "현재 단계/인덱스/완료"를 동기적으로
  // 읽기 위함. setState 업데이터는 비동기로 실행되므로, 업데이터 안에서 지역변수에
  // 값을 담아 밖에서 읽으면 항상 초기값을 보게 된다(과거 버그). 따라서 분기에 필요한
  // 값은 ref에 미러링하고, setState 업데이터는 순수하게(부수효과 없이) 유지한다.
  const phaseRef = useRef<QuizSessionPhase>('idle');
  const currentIndexRef = useRef<number>(0);
  const completedRef = useRef<boolean>(false);

  /**
   * 세트 상세를 비동기로 가져와 첫 문제로 진입(또는 에러)시킨다.
   * 상태 갱신은 모두 await 이후에만 일어나므로 effect에서 직접 호출해도
   * 동기 cascading render를 유발하지 않는다.
   * loading 단계 표시는 호출측(retry)이 책임진다.
   */
  const fetchAndApply = useCallback(async (): Promise<void> => {
    try {
      const detail = await apiRef.current.getSet(quizSetId);
      const questions = sortQuestions(detail.questions);
      questionsRef.current = questions;
      sessionTokenRef.current = tokenGenRef.current();

      if (questions.length === 0) {
        phaseRef.current = 'error';
        setState({
          ...INITIAL_STATE,
          phase: 'error',
          detail,
          error: '문제가 아직 준비되지 않았어요.',
        });
        return;
      }

      currentIndexRef.current = 0;
      completedRef.current = false;
      phaseRef.current = 'answering';
      setState({
        ...INITIAL_STATE,
        phase: 'answering',
        currentIndex: 0,
        total: questions.length,
        currentQuestion: questions[0],
        detail,
        isSelectable: true,
      });
    } catch (err) {
      const info = toQuizErrorInfo(err);
      phaseRef.current = 'error';
      setState({
        ...INITIAL_STATE,
        phase: 'error',
        error: info.message,
        isSessionExpired: info.isSessionExpired,
      });
    }
  }, [quizSetId]);

  /** retry/restart: loading 표시 후 재로드 (이벤트 핸들러 컨텍스트) */
  const load = useCallback(async (): Promise<void> => {
    phaseRef.current = 'loading_questions';
    setState({ ...INITIAL_STATE, phase: 'loading_questions' });
    await fetchAndApply();
  }, [fetchAndApply]);

  // 마운트 / quizSetId 변경 시 자동 로드.
  // 초기 phase는 'idle'(로딩 UI로 처리)이므로 동기 setState 없이 바로 fetch.
  useEffect(() => {
    void fetchAndApply();
  }, [fetchAndApply]);

  /** 현재 문제 답안 제출 → 즉시 채점 */
  const selectAndSubmit = useCallback(
    async (userAnswer: string): Promise<void> => {
      // FSM 가드 + 재진입 방지: 현재 단계/문제를 ref로 동기 확인한다.
      if (phaseRef.current !== 'answering') return;

      const questions = questionsRef.current;
      const idx = currentIndexRef.current;
      const submittedQuestion = questions[idx] ?? null;
      if (submittedQuestion === null) return;

      const isLast = idx >= questions.length - 1;
      // 마지막 문제는 시각적으로 final 제출 단계로 표시.
      const submittingPhase: QuizSessionPhase = isLast
        ? 'submitting_final'
        : 'submitting';
      phaseRef.current = submittingPhase;
      setState((prev) => ({
        ...prev,
        phase: submittingPhase,
        isSelectable: false,
      }));

      try {
        const result = await apiRef.current.submitAttempts(quizSetId, {
          sessionToken: sessionTokenRef.current,
          answers: [{ questionId: submittedQuestion.id, userAnswer }],
        });
        const myResult =
          result.results.find(
            (r) => r.questionId === submittedQuestion.id,
          ) ??
          result.results[0] ??
          null;

        completedRef.current = result.completed;
        phaseRef.current = 'feedback';
        setState((prev) => ({
          ...prev,
          phase: 'feedback',
          lastResult: myResult,
          sessionScore: result.sessionScore,
          completed: result.completed,
          bestScore: result.bestScore ?? prev.bestScore,
          isNewBest: result.isNewBest ?? prev.isNewBest,
        }));
      } catch (err) {
        const info = toQuizErrorInfo(err);
        phaseRef.current = 'error';
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: info.message,
          isSessionExpired: info.isSessionExpired,
        }));
      }
    },
    [quizSetId],
  );

  /** 피드백 → 다음 문제 또는 결과 */
  const next = useCallback((): void => {
    // 피드백 단계에서만 진행 (ref로 동기 가드).
    if (phaseRef.current !== 'feedback') return;

    // 서버가 완료를 알렸으면 결과 화면으로.
    if (completedRef.current) {
      phaseRef.current = 'result';
      setState((prev) => ({ ...prev, phase: 'result' }));
      return;
    }

    const questions = questionsRef.current;
    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex >= questions.length) {
      // 안전망: completed=false인데 마지막을 넘어서면 결과로.
      phaseRef.current = 'result';
      setState((prev) => ({ ...prev, phase: 'result' }));
      return;
    }

    currentIndexRef.current = nextIndex;
    phaseRef.current = 'answering';
    setState((prev) => ({
      ...prev,
      phase: 'answering',
      currentIndex: nextIndex,
      currentQuestion: questions[nextIndex],
      isSelectable: true,
      lastResult: null,
    }));
  }, []);

  const retry = useCallback(async (): Promise<void> => {
    await load();
  }, [load]);

  // restart는 retry의 의미적 별칭(결과 화면 "다시 풀기").
  const restart = retry;

  return [state, { selectAndSubmit, next, retry, restart }];
}
