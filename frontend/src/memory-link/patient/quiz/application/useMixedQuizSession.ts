// 혼합 퀴즈 세션 훅 (데일리 + QAB 질문형 인터리브)
//
// 한 세트 = 백엔드 데일리 문항(기본 5) + QAB 질문형 문항(기본 5)을 섞어 10문제로 진행한다.
// 항목별 채점 위임:
//   - daily : 같은 sessionToken으로 백엔드 /attempts 제출 → 즉시 채점
//   - qab_word : 선택지 isCorrect로 로컬 채점
// 최종 점수는 10문제 중 정답 비율(0..100)로 합산한다.
//
// FSM/ref 미러링 패턴: 이벤트 핸들러에서 최신 단계/인덱스를 동기적으로 읽기 위해
// ref를 사용하고, setState 업데이터는 순수하게 유지한다.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuizSetDetail } from '../domain/Quiz.js';
import type {
  PlayableItem,
  PlayResult,
  QabImageItem,
  QabNamingItem,
  QabRepeatItem,
  QabReadingItem,
  QabDdkItem,
} from '../domain/MixedQuiz.js';
import { isNameMatch } from '../domain/nameMatch.js';
import {
  evaluateSpeech,
  evaluateFromAzure,
  type AzurePronunciationScores,
} from '../domain/pronunciationScore.js';
import { isDdkPass } from '../domain/ddkScore.js';
import type { QabResultInput } from '../domain/QabResult.js';
import { quizApi } from '../infrastructure/QuizApi.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';
import { pickQabItems, pickNamingItems } from '../infrastructure/QabItemBank.js';
import {
  pickRepeatItems,
  pickReadingItems,
  pickDdkItems,
} from '../infrastructure/QabSpeechBank.js';
import { toQuizErrorInfo } from './quizError.js';

export type MixedPhase =
  | 'loading'
  | 'answering'
  | 'submitting'
  | 'feedback'
  | 'result'
  | 'error';

export interface UseMixedQuizState {
  phase: MixedPhase;
  currentIndex: number;
  total: number;
  currentItem: PlayableItem | null;
  detail: QuizSetDetail | null;
  isSelectable: boolean;
  lastResult: PlayResult | null;
  /** qab 피드백 강조용 — 사용자가 고른 선택지 id */
  selectedChoiceId: string | null;
  /** 결과 화면의 합산 점수(0..100) */
  sessionScore: number | null;
  error: string | null;
  isSessionExpired: boolean;
  /** 현재 문항 재응답 횟수 — 문항 컴포넌트 리마운트 key로 쓴다(재시도 시 상태 초기화). */
  attempt: number;
}

export interface UseMixedQuizActions {
  /** 데일리 문항 답안 제출 (백엔드 채점) */
  submitDaily: (userAnswer: string) => Promise<void>;
  /** QAB 단어이해 선택 (로컬 채점) */
  submitQabChoice: (choiceId: string) => void;
  /** QAB 그림 이름대기 음성 제출 (로컬 STT 채점) */
  submitNaming: (
    transcript: string,
    azure?: AzurePronunciationScores | null,
  ) => void;
  /** QAB 따라말하기/소리내어읽기 음성 제출. azure 점수 있으면 음소 채점, 없으면 WER 폴백. */
  submitSpeech: (
    transcript: string,
    azure?: AzurePronunciationScores | null,
  ) => void;
  /** QAB 말운동(DDK) 결과 제출 (감지된 음절 수, 로컬 채점) */
  submitDdk: (count: number) => void;
  /** 발화 문항을 보호자가 "넘어가기"로 통과 처리 (도움받음으로 기록, 정확도 집계 제외) */
  skipCurrent: () => void;
  /** 피드백 확인 → 다음 문항 또는 결과 */
  next: () => void;
  /** 발화/이름대기 문항을 같은 문제로 다시 답한다(직전 결과는 되돌려 이중 집계 방지). */
  answerAgain: () => void;
  /** 보호자가 발화 과제(이름대기·따라말하기·읽기) 자동 채점을 정정한다(피드백 단계). */
  overrideSpeechVerdict: (isCorrect: boolean) => void;
  /** 처음부터 다시 (새 세션 토큰 + 새 QAB 추출) */
  retry: () => Promise<void>;
}

export type UseMixedQuizReturn = [UseMixedQuizState, UseMixedQuizActions];

export interface UseMixedQuizDeps {
  quizApi?: IQuizApi;
  /** QAB 질문형(단어/문장) 문항 추출기 (테스트 주입용) */
  pickQabItems?: (count: number) => QabImageItem[];
  /** QAB 그림 이름대기 문항 추출기 (테스트 주입용) */
  pickNamingItems?: (count: number) => QabNamingItem[];
  /** QAB 따라말하기 문항 추출기 (테스트 주입용) */
  pickRepeatItems?: (count: number) => QabRepeatItem[];
  /** QAB 소리 내어 읽기 문항 추출기 (테스트 주입용) */
  pickReadingItems?: (count: number) => QabReadingItem[];
  /** QAB 말운동(DDK) 문항 추출기 (테스트 주입용) */
  pickDdkItems?: (count: number) => QabDdkItem[];
  generateSessionToken?: () => string;
  /** 데일리 문항 최대 개수 (기본 4) */
  dailyCount?: number;
  /** QAB 듣고 그림 고르기 개수 (기본 2) */
  qabCount?: number;
  /** QAB 그림 이름대기 개수 (기본 1) */
  namingCount?: number;
  /** QAB 따라말하기 개수 (기본 1) */
  repeatCount?: number;
  /** QAB 소리 내어 읽기 개수 (기본 1) */
  readingCount?: number;
  /** QAB 말운동(DDK) 개수 (기본 1) */
  ddkCount?: number;
}

const DEFAULT_DAILY_COUNT = 4;
const DEFAULT_QAB_COUNT = 2;
const DEFAULT_NAMING_COUNT = 1;
const DEFAULT_REPEAT_COUNT = 1;
const DEFAULT_READING_COUNT = 1;
const DEFAULT_DDK_COUNT = 1;

const INITIAL_STATE: UseMixedQuizState = Object.freeze({
  phase: 'loading',
  currentIndex: 0,
  total: 0,
  currentItem: null,
  detail: null,
  isSelectable: false,
  lastResult: null,
  selectedChoiceId: null,
  sessionScore: null,
  error: null,
  isSessionExpired: false,
  attempt: 0,
});

function defaultGenerateToken(): string {
  return crypto.randomUUID();
}

/** Fisher-Yates 셔플 (원본 불변). */
function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function useMixedQuizSession(
  quizSetId: string,
  deps?: UseMixedQuizDeps,
): UseMixedQuizReturn {
  const apiRef = useRef<IQuizApi>(deps?.quizApi ?? quizApi);
  const pickRef = useRef(deps?.pickQabItems ?? pickQabItems);
  const pickNamingRef = useRef(deps?.pickNamingItems ?? pickNamingItems);
  const pickRepeatRef = useRef(deps?.pickRepeatItems ?? pickRepeatItems);
  const pickReadingRef = useRef(deps?.pickReadingItems ?? pickReadingItems);
  const pickDdkRef = useRef(deps?.pickDdkItems ?? pickDdkItems);
  const tokenGenRef = useRef(deps?.generateSessionToken ?? defaultGenerateToken);
  const dailyCount = deps?.dailyCount ?? DEFAULT_DAILY_COUNT;
  const qabCount = deps?.qabCount ?? DEFAULT_QAB_COUNT;
  const namingCount = deps?.namingCount ?? DEFAULT_NAMING_COUNT;
  const repeatCount = deps?.repeatCount ?? DEFAULT_REPEAT_COUNT;
  const readingCount = deps?.readingCount ?? DEFAULT_READING_COUNT;
  const ddkCount = deps?.ddkCount ?? DEFAULT_DDK_COUNT;

  const [state, setState] = useState<UseMixedQuizState>({ ...INITIAL_STATE });

  const sessionTokenRef = useRef<string>('');
  const itemsRef = useRef<PlayableItem[]>([]);
  const phaseRef = useRef<MixedPhase>('loading');
  const indexRef = useRef<number>(0);
  const correctCountRef = useRef<number>(0);
  /** QAB 항목 결과 누적 (세션 완료 시 백엔드 일괄 저장용) */
  const qabResultsRef = useRef<QabResultInput[]>([]);

  /** 세트 상세 로드 + 데일리/QAB 인터리브 구성 */
  const fetchAndApply = useCallback(async (): Promise<void> => {
    try {
      const detail = await apiRef.current.getSet(quizSetId);
      const dailySorted = [...detail.questions].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      const dailyItems: PlayableItem[] = dailySorted
        .slice(0, dailyCount)
        .map((q) => ({ kind: 'daily', id: q.id, question: q }));
      const qabItems: PlayableItem[] = pickRef.current(qabCount).map((it) => ({
        kind: 'qab',
        id: it.itemId,
        item: it,
      }));
      const namingItems: PlayableItem[] = pickNamingRef
        .current(namingCount)
        .map((it) => ({ kind: 'naming', id: it.itemId, item: it }));
      const repeatItems: PlayableItem[] = pickRepeatRef
        .current(repeatCount)
        .map((it) => ({ kind: 'repeat', id: it.itemId, item: it }));
      const readingItems: PlayableItem[] = pickReadingRef
        .current(readingCount)
        .map((it) => ({ kind: 'reading', id: it.itemId, item: it }));
      const ddkItems: PlayableItem[] = pickDdkRef
        .current(ddkCount)
        .map((it) => ({ kind: 'ddk', id: it.itemId, item: it }));

      const merged = shuffle([
        ...dailyItems,
        ...qabItems,
        ...namingItems,
        ...repeatItems,
        ...readingItems,
        ...ddkItems,
      ]);
      itemsRef.current = merged;
      sessionTokenRef.current = tokenGenRef.current();
      correctCountRef.current = 0;
      qabResultsRef.current = [];

      if (merged.length === 0) {
        phaseRef.current = 'error';
        setState({
          ...INITIAL_STATE,
          phase: 'error',
          detail,
          error: '문제가 아직 준비되지 않았어요.',
        });
        return;
      }

      indexRef.current = 0;
      phaseRef.current = 'answering';
      setState({
        ...INITIAL_STATE,
        phase: 'answering',
        currentIndex: 0,
        total: merged.length,
        currentItem: merged[0],
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
  }, [
    quizSetId,
    dailyCount,
    qabCount,
    namingCount,
    repeatCount,
    readingCount,
    ddkCount,
  ]);

  useEffect(() => {
    void fetchAndApply();
  }, [fetchAndApply]);

  /** 채점 결과를 반영해 feedback 단계로 전이 (공통). */
  const applyResult = useCallback(
    (result: PlayResult, selectedChoiceId: string | null): void => {
      if (result.isCorrect) correctCountRef.current += 1;
      phaseRef.current = 'feedback';
      setState((prev) => ({
        ...prev,
        phase: 'feedback',
        lastResult: result,
        selectedChoiceId,
      }));
    },
    [],
  );

  const submitDaily = useCallback(
    async (userAnswer: string): Promise<void> => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== 'daily') return;

      phaseRef.current = 'submitting';
      setState((prev) => ({ ...prev, phase: 'submitting', isSelectable: false }));

      try {
        const res = await apiRef.current.submitAttempts(quizSetId, {
          sessionToken: sessionTokenRef.current,
          answers: [{ questionId: item.question.id, userAnswer }],
        });
        const mine =
          res.results.find((r) => r.questionId === item.question.id) ??
          res.results[0] ??
          null;
        applyResult(
          {
            isCorrect: mine?.isCorrect ?? false,
            correctLabel: mine?.correctAnswer ?? null,
          },
          null,
        );
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
    [quizSetId, applyResult],
  );

  const submitQabChoice = useCallback(
    (choiceId: string): void => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== 'qab') return;

      const chosen = item.item.choices.find((c) => c.choiceId === choiceId);
      const correct = item.item.choices.find((c) => c.isCorrect);
      const isCorrect = chosen?.isCorrect ?? false;
      qabResultsRef.current.push({
        subtest: item.item.category,
        itemRef: item.item.itemId,
        isCorrect,
      });
      applyResult(
        { isCorrect, correctLabel: correct?.label ?? null },
        choiceId,
      );
    },
    [applyResult],
  );

  const submitNaming = useCallback(
    (transcript: string, azure: AzurePronunciationScores | null = null): void => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== 'naming') return;

      // 음소 점수가 있으면 실조음 채점(단어 모드), 없으면 문자열 근접도(isNameMatch)로
      // 폴백. 단어 STT는 매우 불신뢰라, 발음 평가가 있으면 그쪽이 훨씬 공정하다.
      const evaluation = azure
        ? evaluateFromAzure(azure, transcript, 'word')
        : null;
      const correct = evaluation
        ? evaluation.isCorrect
        : isNameMatch(transcript, item.item.targetWord);
      qabResultsRef.current.push({
        subtest: 'naming',
        itemRef: item.item.itemId,
        isCorrect: correct,
        ...(evaluation ? { score: evaluation.score } : {}),
      });
      applyResult(
        {
          isCorrect: correct,
          correctLabel: item.item.targetWord,
          ...(evaluation
            ? { grade: evaluation.grade, encouragement: evaluation.encouragement }
            : {}),
        },
        null,
      );
    },
    [applyResult],
  );

  const submitSpeech = useCallback(
    (transcript: string, azure: AzurePronunciationScores | null = null): void => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item) return;

      if (item.kind === 'repeat') {
        const mode = item.item.category === 'sentence' ? 'sentence' : 'word';
        // 음소 점수가 있으면 실조음 채점, 없으면 문자열 근접도로 폴백.
        const evaluation = azure
          ? evaluateFromAzure(azure, transcript, mode)
          : evaluateSpeech(transcript, item.item.text, mode);
        qabResultsRef.current.push({
          subtest: 'repeat',
          itemRef: item.item.itemId,
          isCorrect: evaluation.isCorrect,
          score: evaluation.score,
        });
        applyResult(
          {
            isCorrect: evaluation.isCorrect,
            correctLabel: item.item.text,
            grade: evaluation.grade,
            encouragement: evaluation.encouragement,
          },
          null,
        );
        return;
      }
      if (item.kind === 'reading') {
        const evaluation = azure
          ? evaluateFromAzure(azure, transcript, 'sentence')
          : evaluateSpeech(transcript, item.item.text, 'sentence');
        qabResultsRef.current.push({
          subtest: 'reading',
          itemRef: item.item.itemId,
          isCorrect: evaluation.isCorrect,
          score: evaluation.score,
        });
        applyResult(
          {
            isCorrect: evaluation.isCorrect,
            correctLabel: item.item.text,
            grade: evaluation.grade,
            encouragement: evaluation.encouragement,
          },
          null,
        );
      }
    },
    [applyResult],
  );

  const submitDdk = useCallback(
    (count: number): void => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== 'ddk') return;

      const correct = isDdkPass(count, item.item.targetCount);
      qabResultsRef.current.push({
        subtest: 'ddk',
        itemRef: item.item.itemId,
        isCorrect: correct,
        metric: count,
      });
      applyResult(
        {
          isCorrect: correct,
          correctLabel: `${item.item.targetCount}회 이상`,
        },
        null,
      );
    },
    [applyResult],
  );

  const skipCurrent = useCallback((): void => {
    if (phaseRef.current !== 'answering') return;
    const item = itemsRef.current[indexRef.current];
    if (!item) return;

    // 발화 검사(이름대기/따라말하기/읽기/말운동)만 넘어가기 대상.
    let subtest: QabResultInput['subtest'];
    let correctLabel: string;
    switch (item.kind) {
      case 'naming':
        subtest = 'naming';
        correctLabel = item.item.targetWord;
        break;
      case 'repeat':
        subtest = 'repeat';
        correctLabel = item.item.text;
        break;
      case 'reading':
        subtest = 'reading';
        correctLabel = item.item.text;
        break;
      case 'ddk':
        subtest = 'ddk';
        correctLabel = `${item.item.targetCount}회 이상`;
        break;
      default:
        return;
    }

    // 도움받음으로 기록(추세 정확도 집계 제외). 환자에겐 긍정 피드백 유지.
    qabResultsRef.current.push({
      subtest,
      itemRef: item.id,
      isCorrect: true,
      assisted: true,
    });
    applyResult({ isCorrect: true, correctLabel }, null);
  }, [applyResult]);

  const next = useCallback((): void => {
    if (phaseRef.current !== 'feedback') return;

    const items = itemsRef.current;
    const nextIndex = indexRef.current + 1;
    if (nextIndex >= items.length) {
      const total = items.length;
      const score =
        total > 0 ? Math.round((correctCountRef.current / total) * 100) : 0;
      // QAB 결과 백엔드 저장 (회복 추적). 실패해도 결과 화면을 막지 않는다(fire-and-forget).
      const qabResults = qabResultsRef.current;
      if (qabResults.length > 0) {
        void Promise.resolve(
          apiRef.current.submitQabResults(sessionTokenRef.current, qabResults),
        ).catch((err) => {
          // 저장 실패는 환자 경험을 막지 않는다(추적 데이터 유실만).
          // 단, 완전 무음이면 추적이 영영 안 쌓여도 모르므로 경고는 남긴다.
          console.warn('[quiz] QAB 결과 저장 실패:', err);
        });
      }
      phaseRef.current = 'result';
      setState((prev) => ({ ...prev, phase: 'result', sessionScore: score }));
      return;
    }

    indexRef.current = nextIndex;
    phaseRef.current = 'answering';
    setState((prev) => ({
      ...prev,
      phase: 'answering',
      currentIndex: nextIndex,
      currentItem: items[nextIndex],
      isSelectable: true,
      lastResult: null,
      selectedChoiceId: null,
    }));
  }, []);

  // 같은 문항을 다시 답한다(발화/이름대기 재시도). 직전 결과를 되돌려
  // 재시도가 점수를 이중 반영하지 않게 하고, attempt를 올려 문항 컴포넌트를
  // 리마운트(내부 status/transcript 초기화)한다.
  const answerAgain = useCallback((): void => {
    if (phaseRef.current !== 'feedback') return;
    const last = qabResultsRef.current.pop();
    if (last?.isCorrect) {
      correctCountRef.current = Math.max(0, correctCountRef.current - 1);
    }
    phaseRef.current = 'answering';
    setState((prev) => ({
      ...prev,
      phase: 'answering',
      isSelectable: true,
      lastResult: null,
      selectedChoiceId: null,
      attempt: prev.attempt + 1,
    }));
  }, []);

  // 보호자가 발화 과제(이름대기·따라말하기·읽기) 자동 채점을 정정한다(피드백 단계).
  // 이유:
  //  - 이름대기: 발음 평가는 '얼마나 잘 발음했나'만 재고 '무슨 단어인지'는 못 가림.
  //  - 따라말하기·읽기: 발음 평가 불가 시 문자열 채점(불신뢰 STT)으로 폴백함.
  // 두 경우 모두 옆의 보호자가 경계 사례를 최종 판정한다. 직전 결과의 isCorrect를
  // 바꾸고 정확도 집계를 보정한다.
  //
  // assisted는 건드리지 않는다. assisted는 '도움받음(정확도 집계 제외)'을 뜻하는데,
  // 정정은 도움이 아니라 기계 오채점을 사람이 바로잡은 것이다. 특히 거짓 오답을
  // 정답으로 정정하면 환자는 독립적으로 맞힌 것이므로 미보조 정답으로 남아야 한다
  // (assisted로 찍으면 회복추적에서 빠져 실력이 과소평가된다). 넘어가기로 이미
  // assisted였던 항목은 그 값을 그대로 보존한다.
  const overrideSpeechVerdict = useCallback((isCorrect: boolean): void => {
    if (phaseRef.current !== 'feedback') return;
    const item = itemsRef.current[indexRef.current];
    const SPEECH_KINDS = ['naming', 'repeat', 'reading'];
    if (!item || !SPEECH_KINDS.includes(item.kind)) return;
    const last = qabResultsRef.current[qabResultsRef.current.length - 1];
    if (!last || !SPEECH_KINDS.includes(last.subtest)) return;
    if (last.isCorrect === isCorrect) return; // 변화 없음
    correctCountRef.current = Math.max(
      0,
      correctCountRef.current + (isCorrect ? 1 : -1),
    );
    last.isCorrect = isCorrect;
    setState((prev) => ({
      ...prev,
      lastResult: prev.lastResult
        ? { ...prev.lastResult, isCorrect }
        : prev.lastResult,
    }));
  }, []);

  const retry = useCallback(async (): Promise<void> => {
    phaseRef.current = 'loading';
    setState({ ...INITIAL_STATE, phase: 'loading' });
    await fetchAndApply();
  }, [fetchAndApply]);

  return [
    state,
    {
      submitDaily,
      submitQabChoice,
      submitNaming,
      submitSpeech,
      submitDdk,
      skipCurrent,
      next,
      answerAgain,
      overrideSpeechVerdict,
      retry,
    },
  ];
}
