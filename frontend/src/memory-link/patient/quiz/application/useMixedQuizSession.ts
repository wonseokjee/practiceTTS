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
  PlayResult,
  PlayableItem,
  QabDdkItem,
  QabImageItem,
  QabNamingItem,
  QabReadingItem,
  QabRepeatItem,
  QabSpellItem,
} from '../domain/MixedQuiz.js';
import { isNameMatch } from '../domain/nameMatch.js';
import {
  evaluateSpeech,
  evaluateFromAzure,
  type AzurePronunciationScores,
} from '../domain/pronunciationScore.js';
import { isDdkPass } from '../domain/ddkScore.js';
import type { QabResultInput, QabSubtest } from '../domain/QabResult.js';
import { quizApi } from '../infrastructure/QuizApi.js';
import type { IQuizApi } from '../infrastructure/QuizApi.js';
import {
  pickWordItems,
  pickSentItems,
  pickNamingItems,
  pickSpellItems,
  asItemRef,
  asWordLabel,
} from '../infrastructure/QabItemBank.js';
import type {
  PickSpellOptions,
  SpellItemRef,
} from '../infrastructure/QabItemBank.js';
import {
  moveEasiestLast,
  shouldFatigueExit,
} from '../domain/sessionSafeguards.js';
import {
  itemCountFor,
  rotationForToday,
} from '../domain/subtestRotation.js';
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
  /** QAB 글자 조합 제출 (타일로 만든 문자열, 로컬 비교 채점) */
  submitSpell: (assembled: string) => void;
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
  /**
   * 낱말 이해 문항 추출기 (테스트 주입용). level로 제시 난이도 지정.
   *
   * 예전에는 낱말과 문장을 `pickQabItems` 하나가 슬롯 추첨으로 섞었다. 그래서
   * 문장이 세션당 0.444문항밖에 안 나왔고(세션의 60%는 문장 0문항), 문장만
   * 판정 지연이 11세션이었다. 로테이션은 어느 검사를 낼지 명시적으로 정하므로
   * 추첨이 필요 없다 — 두 풀을 따로 뽑는다.
   */
  pickWordItems?: (count: number, level?: number) => QabImageItem[];
  /** 문장 이해 문항 추출기 (테스트 주입용). level로 제시 난이도 지정. */
  pickSentItems?: (count: number, level?: number) => QabImageItem[];
  /** QAB 그림 이름대기 문항 추출기 (테스트 주입용). level로 제시 난이도 지정. */
  /** 이름대기 문항 추출기 (테스트 주입용). 이름대기는 비레벨 검사라 level이 없다. */
  pickNamingItems?: (count: number) => QabNamingItem[];
  /** 글자 조합 문항 추출(테스트 주입용). level이 방해 타일 수를 정한다. */
  pickSpellItems?: (
    count: number,
    level?: number,
    options?: PickSpellOptions,
  ) => QabSpellItem[];
  /** QAB 따라말하기 문항 추출기 (테스트 주입용) */
  pickRepeatItems?: (count: number, level?: number) => QabRepeatItem[];
  /** QAB 소리 내어 읽기 문항 추출기 (테스트 주입용) */
  pickReadingItems?: (count: number, level?: number) => QabReadingItem[];
  /** QAB 말운동(DDK) 문항 추출기 (테스트 주입용) */
  pickDdkItems?: (count: number, level?: number) => QabDdkItem[];
  generateSessionToken?: () => string;
  /**
   * 오늘 낼 하위검사 세 개 (테스트 주입용). 미지정 시 오늘 날짜의 로테이션.
   * 개수 옵션을 따로 주면 그쪽이 이긴다.
   */
  rotation?: readonly QabSubtest[];
  /** 데일리 문항 개수 (기본 2) */
  dailyCount?: number;
  /** 낱말 이해 개수 (기본: 로테이션에 있으면 3, 없으면 0) */
  wordCount?: number;
  /** 문장 이해 개수 (기본: 로테이션에 있으면 3, 없으면 0) */
  sentenceCount?: number;
  /** 그림 이름대기 개수 (기본: 로테이션) */
  namingCount?: number;
  /** 글자 조합 개수 (기본: 로테이션) */
  spellCount?: number;
  /** 따라말하기 개수 (기본: 로테이션) */
  repeatCount?: number;
  /** 소리 내어 읽기 개수 (기본: 로테이션) */
  readingCount?: number;
  /** 말운동(DDK) 개수 (기본: 로테이션) */
  ddkCount?: number;
}

/** success-ending 순위: 성공 확률 높은 종류가 클수록 뒤로 간다. */
const SUCCESS_RANK: Record<PlayableItem['kind'], number> = {
  qab: 3, // 그림선택(자동채점·비처벌) — 성공 확률 최고
  daily: 2, // 데일리(백엔드 채점)
  spell: 2, // 글자 조합 — 타일이 주어져 산출 과제 중에선 성공 확률이 높다
  naming: 1, // 이하 발화 산출 — 낮음
  repeat: 1,
  reading: 1,
  ddk: 1,
};

/**
 * 데일리 문항 수 4 → 2.
 *
 * 로테이션이 QAB에 9문항(3검사 × 3)을 쓰므로, 세션 길이 11을 지키려면 데일리가
 * 2로 내려와야 한다. 길이를 늘리는 쪽(18문항)은 고령·실어증 환자의 순응도를
 * 사서 쓰는 것이라 택하지 않았다.
 */
const DEFAULT_DAILY_COUNT = 2;

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
  const pickWordRef = useRef(deps?.pickWordItems ?? pickWordItems);
  const pickSentRef = useRef(deps?.pickSentItems ?? pickSentItems);
  const pickNamingRef = useRef(deps?.pickNamingItems ?? pickNamingItems);
  const pickSpellRef = useRef(deps?.pickSpellItems ?? pickSpellItems);
  const pickRepeatRef = useRef(deps?.pickRepeatItems ?? pickRepeatItems);
  const pickReadingRef = useRef(deps?.pickReadingItems ?? pickReadingItems);
  const pickDdkRef = useRef(deps?.pickDdkItems ?? pickDdkItems);
  const tokenGenRef = useRef(deps?.generateSessionToken ?? defaultGenerateToken);
  // 오늘의 하위검사 세 개. 마운트 때 한 번 정해 자정을 넘겨도 안 바뀐다 —
  // 세션 도중에 구성이 바뀌면 남은 문항이 다른 검사로 갈아끼워진다.
  const [rotation] = useState<readonly QabSubtest[]>(
    () => deps?.rotation ?? rotationForToday(),
  );
  const dailyCount = deps?.dailyCount ?? DEFAULT_DAILY_COUNT;
  const wordCount = deps?.wordCount ?? itemCountFor('word', rotation);
  const sentenceCount = deps?.sentenceCount ?? itemCountFor('sentence', rotation);
  const namingCount = deps?.namingCount ?? itemCountFor('naming', rotation);
  const spellCount = deps?.spellCount ?? itemCountFor('spell', rotation);
  const repeatCount = deps?.repeatCount ?? itemCountFor('repeat', rotation);
  const readingCount = deps?.readingCount ?? itemCountFor('reading', rotation);
  const ddkCount = deps?.ddkCount ?? itemCountFor('ddk', rotation);

  const [state, setState] = useState<UseMixedQuizState>({ ...INITIAL_STATE });

  const sessionTokenRef = useRef<string>('');
  const itemsRef = useRef<PlayableItem[]>([]);
  const phaseRef = useRef<MixedPhase>('loading');
  const indexRef = useRef<number>(0);
  /**
   * 답한 문항의 정오답 로그(종류 무관, 답한 순서대로). 정답수·연속오답을 여기서
   * 파생한다 — 정정(overrideSpeechVerdict)·재시도(answerAgain)가 이 로그만 고치면
   * 점수와 피로 탈출 판정이 자동으로 일관되게 맞는다(각 지점을 따로 갱신하다
   * 어긋나는 버그 방지).
   */
  const recentCorrectRef = useRef<boolean[]>([]);
  /** QAB 항목 결과 누적 (세션 완료 시 백엔드 일괄 저장용) */
  const qabResultsRef = useRef<QabResultInput[]>([]);
  /** 이미 백엔드에 제출한 결과 수. 점진 제출에서 미전송 tail만 보낸다. */
  const submittedCountRef = useRef<number>(0);
  /** 문항 풀 매니페스트 버전(레벨 조회 시 받음). 결과 제출에 함께 보낸다. */
  const manifestVersionRef = useRef<number | undefined>(undefined);

  /** 세트 상세 로드 + 데일리/QAB 인터리브 구성 */
  const fetchAndApply = useCallback(async (): Promise<void> => {
    try {
      const detail = await apiRef.current.getSet(quizSetId);

      // 적응형: 스킬별 현재 레벨을 읽어 문항 제시 난이도를 정한다. 조회 실패는
      // 비차단 — 기본 난이도(레벨 미지정)로 진행한다(레벨은 환자에게 비노출).
      let levels: Partial<Record<QabSubtest, number>> | undefined;
      try {
        const skillLevels = await apiRef.current.getSkillLevels();
        levels = skillLevels.levels;
        manifestVersionRef.current = skillLevels.manifestVersion;
      } catch {
        levels = undefined;
        manifestVersionRef.current = undefined;
      }

      const dailySorted = [...detail.questions].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      const dailyItems: PlayableItem[] = dailySorted
        .slice(0, dailyCount)
        .map((q) => ({ kind: 'daily', id: q.id, question: q }));
      // 낱말과 문장은 화면에선 같은 종류('듣고 그림 고르기')지만 하위검사로는
      // 별개다. 로테이션이 둘 중 무엇을 낼지 정하므로 각 풀에서 따로 뽑는다.
      const qabItems: PlayableItem[] = [
        ...pickWordRef.current(wordCount, levels?.word),
        ...pickSentRef.current(sentenceCount, levels?.sentence),
      ].map((it) => ({ kind: 'qab', id: it.itemId, item: it }));
      // 이름대기는 비레벨 검사다 — levels.naming을 넘기지 않는다.
      const namingItems: PlayableItem[] = pickNamingRef
        .current(namingCount)
        .map((it) => ({ kind: 'naming', id: it.itemId, item: it }));
      // 재출제 순서 = 간격 반복. 백엔드가 (틀린 것 먼저, 그 안에서 마지막 출제가
      // 오래된 것 먼저) 순으로 주므로 **응답 순서를 그대로 넘긴다.** 여기서
      // 거르지 않는 게 핵심이다 — 맞힌 문항까지 포함해야 "오래 안 나온 것부터"가
      // 성립하고, 그래야 간격이 생긴다. 틀린 것만 남기면 맞힌 문항은 순서가
      // 사라져 다음 세션에 우연히 또 나올 수도, 영영 안 나올 수도 있다.
      //
      // 후보가 레벨당 26~69개이고 세션당 1문항이라, 이 순서만으로 자연스럽게
      // 26~69일 주기가 나온다. 별도의 간격 상수를 두지 않는 이유다.
      //
      // 실어증 치료 이득은 훈련한 그 항목을 크게 넘어가지 않으므로
      // (limited transfer), 같은 목표가 여러 세션에 반복돼야 의미가 있다.
      // 조회에 실패해도 세션은 진행한다(무작위로 떨어질 뿐).
      let spellPriority: SpellItemRef[] = [];
      if (spellCount > 0) {
        try {
          const recent = await apiRef.current.getRecentItems('spell');
          spellPriority = recent.map((r) => asItemRef(r.itemRef));
        } catch {
          spellPriority = [];
        }
      }
      // 같은 세션의 단어이해 문항이 정답 단어를 TTS로 들려주므로(promptText),
      // 그 단어가 글자 조합으로 또 나오면 답을 알려준 셈이다.
      const spokenWords = qabItems
        .map((p) => (p.kind === 'qab' ? p.item.promptText : ''))
        .filter((w) => w.length > 0)
        .map(asWordLabel);
      const spellItems: PlayableItem[] = pickSpellRef
        .current(spellCount, levels?.spell, {
          exclude: spokenWords,
          priority: spellPriority,
        })
        .map((it) => ({ kind: 'spell', id: it.itemId, item: it }));
      // 발화 검사도 레벨을 받는다. 예전엔 이 셋만 레벨 없이 무작위로 뽑았는데,
      // 보호자 화면은 loc를 뺀 모든 검사에 1~5단계가 있다고 표시하고 있었다 —
      // 같은 과제를 계속 내면서 숫자만 오르내리는 구조였다. 재활 앱에서 그건
      // 단순한 UI 오류가 아니라 보호자의 임상 판단을 오염시키는 거짓 신호다.
      const repeatItems: PlayableItem[] = pickRepeatRef
        .current(repeatCount, levels?.repeat)
        .map((it) => ({ kind: 'repeat', id: it.itemId, item: it }));
      const readingItems: PlayableItem[] = pickReadingRef
        .current(readingCount, levels?.reading)
        .map((it) => ({ kind: 'reading', id: it.itemId, item: it }));
      const ddkItems: PlayableItem[] = pickDdkRef
        .current(ddkCount, levels?.ddk)
        .map((it) => ({ kind: 'ddk', id: it.itemId, item: it }));

      const shuffled = shuffle([
        ...dailyItems,
        ...qabItems,
        ...namingItems,
        ...spellItems,
        ...repeatItems,
        ...readingItems,
        ...ddkItems,
      ]);
      // success-ending: 성취감으로 마무리하도록 성공 확률 높은 항목을 맨 뒤로.
      // 그림선택(qab)은 자동채점·비처벌이라 성공 확률이 가장 높고, 발화(naming/
      // repeat/reading/ddk)는 산출 과제라 낮게 둔다.
      const merged = moveEasiestLast(shuffled, (it) => SUCCESS_RANK[it.kind]);
      itemsRef.current = merged;
      sessionTokenRef.current = tokenGenRef.current();
      recentCorrectRef.current = [];
      qabResultsRef.current = [];
      submittedCountRef.current = 0;

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
    wordCount,
    sentenceCount,
    namingCount,
    repeatCount,
    readingCount,
    spellCount,
    ddkCount,
  ]);

  useEffect(() => {
    void fetchAndApply();
  }, [fetchAndApply]);

  /** 채점 결과를 반영해 feedback 단계로 전이 (공통). */
  /** 로그 끝에서부터 연속 오답 수(피로 탈출 판정용). */
  const trailingWrong = (): number => {
    const log = recentCorrectRef.current;
    let n = 0;
    for (let i = log.length - 1; i >= 0 && !log[i]; i -= 1) n += 1;
    return n;
  };

  const applyResult = useCallback(
    (result: PlayResult, selectedChoiceId: string | null): void => {
      recentCorrectRef.current.push(result.isCorrect);
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
        ...(item.item.presentedLevel !== undefined
          ? { presentedLevel: item.item.presentedLevel }
          : {}),
        // 틀렸을 때만, 그리고 갈래를 아는 선택지일 때만 보낸다. 단어이해
        // 선택지는 뱅크가 뽑으면서 갈래를 붙여 두고(QabFoilKind), 문장이해는
        // 선택지가 JSON 고정 쌍이라 갈래가 없다.
        ...(!isCorrect && chosen?.foilKind !== undefined
          ? { foilKind: chosen.foilKind }
          : {}),
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
        ...(item.item.presentedLevel !== undefined
          ? { presentedLevel: item.item.presentedLevel }
          : {}),
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

  const submitSpell = useCallback(
    (assembled: string): void => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== 'spell') return;

      // 채점은 공백 제거 후 문자열 일치. 타일을 누른 순서가 곧 답이므로
      // 발화 채점처럼 관대하게 볼 여지가 없다 — 만든 글자가 목표와 같거나 다르다.
      const norm = (t: string): string => t.replace(/\s+/g, '');
      const correct = norm(assembled) === norm(item.item.targetWord);
      qabResultsRef.current.push({
        subtest: 'spell',
        itemRef: item.item.itemId,
        isCorrect: correct,
        ...(item.item.presentedLevel !== undefined
          ? { presentedLevel: item.item.presentedLevel }
          : {}),
      });
      applyResult(
        { isCorrect: correct, correctLabel: item.item.targetWord },
        null,
      );
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
      case 'spell':
        subtest = 'spell';
        correctLabel = item.item.targetWord;
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

  // 점진 제출: 아직 안 보낸 결과(tail)만 백엔드에 저장한다. 세션 끝 1회가 아니라
  // 문항을 넘길 때마다 보내, 환자가 중도 이탈해도 그때까지의 결과·이탈 지점이
  // 남는다(관측성). qab_results dedup UNIQUE로 재시도/중복은 멱등. 실패는 비차단 —
  // submittedCount를 올리지 않으므로 다음 flush에서 재시도된다.
  //
  // completed: 이 flush가 세션의 진짜 끝(자연 종료 또는 피로 탈출)일 때만 true로
  // 보낸다. 백엔드가 완료 마커를 남겨 "완료 vs 중단"을 구분한다(보호자 대시보드
  // 이탈/완료율 통계용) — 언마운트 시 best-effort flush는 completed를 안 보내
  // 중도 이탈로 남는다.
  const flushPending = useCallback((completed = false): void => {
    const all = qabResultsRef.current;
    const pending = all.slice(submittedCountRef.current);
    // **완료 마커는 보낼 tail이 없어도 보내야 한다.**
    //
    // 예전엔 `pending.length === 0`이면 completed를 보기도 전에 반환했다.
    // 문항마다 점진 제출하므로 세션이 끝나는 시점엔 tail이 비어 있는 경우가
    // 흔하고(특히 피로 탈출), 그때 설계상 정상 종료가 중도 이탈로 기록됐다.
    // 보호자는 환자가 자주 포기한다고 오해하게 된다.
    if (pending.length === 0 && !completed) return;
    const targetCount = all.length;
    void Promise.resolve(
      apiRef.current.submitQabResults(
        sessionTokenRef.current,
        pending,
        manifestVersionRef.current,
        completed,
      ),
    )
      .then(() => {
        submittedCountRef.current = targetCount;
      })
      .catch((err) => {
        // 저장 실패는 환자 경험을 막지 않는다. 다음 flush에서 재시도(멱등).
        console.warn('[quiz] QAB 결과 점진 저장 실패:', err);
      });
  }, []);

  const next = useCallback((): void => {
    if (phaseRef.current !== 'feedback') return;

    const items = itemsRef.current;
    const nextIndex = indexRef.current + 1;
    // 피로 탈출: 연속 오답이 임계에 닿으면 남은 문항이 있어도 그날 세션을 조기
    // 종료한다. 좌절을 누적시키지 않는 게 순응도에 낫다(성공 경험 원칙).
    const fatigued = shouldFatigueExit(trailingWrong());
    const isSessionEnd = nextIndex >= items.length || fatigued;
    // 방금 확정된 문항 결과를 점진 제출(answerAgain 정정 이후라 최종값). 세션의
    // 진짜 끝(자연 종료·피로 탈출)이면 완료 마커도 함께 보낸다.
    flushPending(isSessionEnd);
    if (isSessionEnd) {
      // 점수 분모는 **실제로 푼 문항 수**다. 피로 탈출 시 안 푼 문항까지 오답으로
      // 세면(0/10) 배려로 끝낸 세션이 되레 좌절을 준다 — 조기 종료의 목적과 반대.
      const attempted = recentCorrectRef.current.length;
      const correct = recentCorrectRef.current.filter(Boolean).length;
      const score =
        attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
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
  }, [flushPending]);

  // 화면 이탈(언마운트) 시 마지막으로 답한(아직 next 안 누른) 문항 결과도 저장한다.
  // 중도 이탈을 최대한 포착하기 위한 best-effort flush.
  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  // 같은 문항을 다시 답한다(발화/이름대기 재시도). 직전 결과를 되돌려
  // 재시도가 점수를 이중 반영하지 않게 하고, attempt를 올려 문항 컴포넌트를
  // 리마운트(내부 status/transcript 초기화)한다.
  const answerAgain = useCallback((): void => {
    if (phaseRef.current !== 'feedback') return;
    // 직전 결과를 로그에서 되돌린다 — 재시도가 새 결과로 다시 집계되게(점수·연속오답
    // 모두 recentCorrect에서 파생되므로 이 pop 하나로 일관 유지).
    qabResultsRef.current.pop();
    recentCorrectRef.current.pop();
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
    last.isCorrect = isCorrect;
    // 로그의 마지막 항목도 함께 뒤집는다 — 점수·연속오답이 정정을 반영하게.
    // (안 고치면 정정된 정답인데도 연속오답으로 남아 피로 탈출이 잘못 발동.)
    const log = recentCorrectRef.current;
    if (log.length > 0) log[log.length - 1] = isCorrect;
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
      submitSpell,
      submitDdk,
      skipCurrent,
      next,
      answerAgain,
      overrideSpeechVerdict,
      retry,
    },
  ];
}
