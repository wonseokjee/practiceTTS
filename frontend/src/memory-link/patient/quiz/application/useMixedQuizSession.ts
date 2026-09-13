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
import { shuffle } from '../../../../shared/domain/shuffle.js';
import { enqueue as enqueueQabOutbox } from '../../../shared/QabOutbox.js';
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
import {
  evaluateFromAzure,
  UNSCORED,
  type SpeechAssessment,
  type AzurePronunciationScores,
} from '../domain/pronunciationScore.js';
import { isDdkPass } from '../domain/ddkScore.js';
import {
  stampAnswered,
  type QabResultInput,
  type QabSubtest,
} from '../domain/QabResult.js';
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
  PickQabOptions,
  PickSpellOptions,
  SpellItemRef,
  SpellWordLabel,
} from '../infrastructure/QabItemBank.js';
import {
  moveEasiestLast,
  shouldFatigueExit,
} from '../domain/sessionSafeguards.js';
import {
  itemCountFor,
  rotationForToday,
} from '../domain/subtestRotation.js';
import { adaptedLevel } from '../domain/sessionAdaptation.js';
import { CUE_GIVEN, CUE_NONE, CUE_SEMANTIC } from '../domain/namingCue.js';
import { playableSubtest } from '../domain/MixedQuiz.js';
import {
  pickRepeatItems,
  pickReadingItems,
  pickDdkItems,
} from '../infrastructure/QabSpeechBank.js';
import type { PickSpeechOptions } from '../infrastructure/QabSpeechBank.js';
import { toQuizErrorInfo } from './quizError.js';

/**
 * QAB 결과를 쌓으며 **푼 시각**을 찍는다(계획 OV-B).
 *
 * 결과는 이 ref에 쌓였다가 문항마다 tail로 보내지고, 실패하면 다음 flush에서
 * 다시 보내진다. 시각을 **보낼 때** 찍으면 재시도한 만큼 늦어지고, 앞으로
 * 재전송 대기열(QabOutbox)이 붙으면 며칠씩 밀린다. 그래서 쌓는 순간 찍는다.
 *
 * 결과를 쌓는 곳이 여섯이라 한 곳으로 모은다 — 하나라도 직접 push하면 그
 * 문항만 서버 시각으로 떨어진다. `QabResult.test.ts`의 가드가 그걸 막는다.
 */
function pushAnswered(
  ref: { current: QabResultInput[] },
  result: QabResultInput,
): void {
  ref.current.push(stampAnswered(result));
}

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
  /**
   * 데일리 문항 답안 제출 (백엔드 채점).
   *
   * `assisted`는 보호자가 "넘어가기"로 통과시켰다는 뜻이다. 정답을 클라이언트가
   * 미리 알 수 없는 유형(예전 `tile_arrange`가 그랬다 — #48로 은퇴)은 빈 문자열을
   * 보내 오답 처리를 받고 서버가 돌려주는 correctAnswer로 피드백을 채우는 식으로
   * 썼다 — speech처럼 정답(targetWord)이 애초에 공개돼 있어 그 값을 그대로
   * 제출하는 유형과 달리, "채점표를 요청해서 받는" 경로였다. 지금 데일리 유형
   * 중에는 이 조건에 해당하는 것이 없어 `assisted=true` 호출부가 없지만, 파라미터
   * 자체는 QAB의 assisted와 같은 서버 계약(정확도 집계 제외)이라 남겨 둔다.
   * 데일리 문항엔 적응형 레벨링이 없어(recordForAdaptation이 subtest===null로
   * no-op) 그쪽엔 영향이 없다.
   */
  submitDaily: (userAnswer: string, assisted?: boolean) => Promise<void>;
  /** QAB 단어이해 선택 (로컬 채점) */
  submitQabChoice: (choiceId: string, ctx?: { unheard?: boolean }) => void;
  /** QAB 그림 이름대기 음성 제출 (로컬 STT 채점) */
  submitNaming: (
    transcript: string,
    azure?: AzurePronunciationScores | null,
    /** 몇 단계까지 단서를 받고 답했나(E18). 생략하면 무단서. */
    cueLevel?: number,
  ) => void;
  /** QAB 따라말하기/소리내어읽기 음성 제출. azure 점수 있으면 음소 채점, 없으면 WER 폴백. */
  submitSpeech: (
    transcript: string,
    azure?: AzurePronunciationScores | null,
    ctx?: { unheard?: boolean },
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
  pickWordItems?: (
    count: number,
    level?: number,
    options?: PickQabOptions,
  ) => QabImageItem[];
  /** 문장 이해 문항 추출기 (테스트 주입용). level로 제시 난이도 지정. */
  pickSentItems?: (
    count: number,
    level?: number,
    options?: PickQabOptions,
  ) => QabImageItem[];
  /** QAB 그림 이름대기 문항 추출기 (테스트 주입용). level로 제시 난이도 지정. */
  /** 이름대기 문항 추출기 (테스트 주입용). 이름대기는 비레벨 검사라 level이 없다. */
  pickNamingItems?: (
    count: number,
    options?: PickQabOptions,
  ) => QabNamingItem[];
  /** 글자 조합 문항 추출(테스트 주입용). level이 방해 타일 수를 정한다. */
  pickSpellItems?: (
    count: number,
    level?: number,
    options?: PickSpellOptions,
  ) => QabSpellItem[];
  /** QAB 따라말하기 문항 추출기 (테스트 주입용) */
  pickRepeatItems?: (
    count: number,
    level?: number,
    options?: PickSpeechOptions,
  ) => QabRepeatItem[];
  /** QAB 소리 내어 읽기 문항 추출기 (테스트 주입용) */
  pickReadingItems?: (
    count: number,
    level?: number,
    options?: PickSpeechOptions,
  ) => QabReadingItem[];
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

/**
 * 결과에 함께 싣는 **관측 필드** — 값이 있는 것만 넣는다.
 *
 * 셋 다 "그 문항이 실제로 어떤 조건이었나"이고 채점에는 안 쓴다. 한 자리에 모아
 * 두는 이유는 제출 지점이 여섯 곳이라서다 — 흩어 두면 새 필드를 넣을 때 한둘을
 * 빠뜨리고, 그러면 그 하위검사만 조용히 기록이 빈다.
 */
function observed(item: {
  presentedLevel?: number;
  bandFallback?: boolean;
  stimulusKind?: 'photo' | 'svg';
}) {
  return {
    ...(item.presentedLevel !== undefined
      ? { presentedLevel: item.presentedLevel }
      : {}),
    ...(item.bandFallback ? { bandFallback: true } : {}),
    ...(item.stimulusKind ? { stimulusKind: item.stimulusKind } : {}),
  };
}

/** 답한 문항 하나의 로그. `assisted`는 보호자가 넘긴 문항(환자 수행 아님). */
interface AnswerLogEntry {
  /**
   * **null은 채점 불가**다 — 오답이 아니라 측정 실패.
   *
   * 세션 점수의 분모와 피로 탈출의 연속 오답, 두 군데 모두에서 빠져야 한다.
   * 못 잰 것을 오답으로 세면 채점기가 흔들린 날마다 환자 점수가 떨어진다.
   */
  isCorrect: boolean | null;
  assisted: boolean;
}

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
   * 답한 문항의 로그(종류 무관, 답한 순서대로). 정답수·연속오답을 여기서
   * 파생한다 — 정정(overrideSpeechVerdict)·재시도(answerAgain)가 이 로그만 고치면
   * 점수와 피로 탈출 판정이 자동으로 일관되게 맞는다(각 지점을 따로 갱신하다
   * 어긋나는 버그 방지).
   *
   * **`assisted`를 함께 들고 있는다.** 예전에는 정오답만 담았고 보호자 "넘어가기"가
   * `true`로 들어갔다. 그래서 보호자가 전부 넘기면 점수가 100점이 나오고, 더 나쁘게는
   * **피로 탈출이 무력화됐다** — 연속 오답 사이에 넘어가기가 하나 끼면 카운터가
   * 0으로 리셋돼, 힘들어서 넘긴 바로 그 상황에서 안전장치가 꺼졌다.
   */
  const recentCorrectRef = useRef<AnswerLogEntry[]>([]);
  /** QAB 항목 결과 누적 (세션 완료 시 백엔드 일괄 저장용) */
  const qabResultsRef = useRef<QabResultInput[]>([]);
  /** 이미 백엔드에 제출한 결과 수. 점진 제출에서 미전송 tail만 보낸다. */
  const submittedCountRef = useRef<number>(0);
  /** 문항 풀 매니페스트 버전(레벨 조회 시 받음). 결과 제출에 함께 보낸다. */
  const manifestVersionRef = useRef<number | undefined>(undefined);
  /** 세션 시작 시 서버가 준 검사별 레벨. 적응의 기준점이다. */
  const startLevelsRef = useRef<Partial<Record<QabSubtest, number>>>({});
  /**
   * 검사별 이번 세션 정오답 기록. 적응 판정의 입력이다.
   *
   * 보호자 "넘어가기"(assisted)는 **넣지 않는다.** 그건 환자가 맞힌 게 아니라
   * 보호자가 통과시킨 것이라, 세면 연속 정답 3회가 채워져 못 푸는 레벨로 올라간다.
   */
  const subtestTrailRef = useRef<Map<QabSubtest, boolean[]>>(new Map());
  /**
   * 글자 조합에서 빼야 할 낱말 — 같은 세션의 낱말이해 문항이 TTS로 들려준 정답들.
   * 적응이 문항을 다시 뽑을 때도 같은 규칙을 지켜야 답을 알려주지 않는다.
   */
  const spellExcludeRef = useRef<SpellWordLabel[]>([]);

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
      // `GET /quiz/recent-items`를 최대 여섯(word·sentence·naming·repeat·
      // reading·spell) 병렬 조회한다. 로테이션이 하루 3검사만 내므로 실제로는
      // 최대 셋만 count>0.
      //
      // **여섯의 쓰임이 갈린다.** spell은 그 결과를 재출제 **우선순위**로 쓴다 —
      // 실어증 치료는 훈련한 항목이 멀리 전이되지 않으므로(limited transfer),
      // 같은 목표가 여러 세션에 반복돼야 의미가 있다. 백엔드가 이미
      // (틀린 것 먼저, 마지막 출제가 오래된 것 먼저) 순으로 주므로 그 순서를
      // 그대로 넘기면 간격 반복이 된다.
      //
      // 나머지 다섯(word·sentence·naming·repeat·reading)은 **정답률로 회복을
      // 재는 측정용**이다. 같은 문항이 자주 나오면 정답률이 이해력이 아니라
      // 그 문항의 암기도를 재게 된다 — 그래서 여기는 결과를 **제외 집합**으로
      // 쓴다. spell과 정확히 반대 방향이다. repeat·reading은 원래 재출제 장치가
      // 없던 순수 무작위 검사였고 정답률이 같은 레벨·추세로 나가므로 이 다섯에
      // 합류시켰다(TODOS "QAB 세션" 절, 2026-09-02).
      //
      // 조회 실패는 무작위로 떨어질 뿐이라 세션은 그대로 진행한다.
      //
      // `days` 기본값(백엔드 30일)은 밴드 크기 39개 기준이다. 90일
      // 무겹침(밴드당 116개)에 콘텐츠가 이미 닿은 검사만 90을 넘긴다 —
      // 아직 자산이 모자란 검사(문장이해·이름대기, #150·#151)에 90을
      // 넘기면 콘텐츠보다 창이 먼저 벌어져 되돌리기만 늘어난다
      // (TODOS "QAB 90일" 절, 2026-09-06).
      //   낱말(전체 116, 레벨 무관 단일 풀) · 따라말하기·읽기(다섯 레벨
      //   전부 116 이상, #138~#143) — 90일로 올림.
      //   문장이해(밴드당 40) · 이름대기(89) — 30일 유지.
      const NINETY_DAY_SUBTESTS: ReadonlySet<QabSubtest> = new Set([
        'word',
        'repeat',
        'reading',
      ]);
      const fetchExclude = async (
        subtest: QabSubtest,
      ): Promise<Set<string> | undefined> => {
        try {
          // days를 아예 안 넘기면(단일 인자 호출) 백엔드 기본값 30일 그대로다.
          // 인자를 둘 다 항상 넘기면서 undefined를 쓰지 않는 이유는, 그러면
          // 호출이 (subtest, undefined) 형태로 기록되어 기존 단일 인자
          // 호출을 기대하는 곳과 어긋나기 때문이다.
          const recent = NINETY_DAY_SUBTESTS.has(subtest)
            ? await apiRef.current.getRecentItems(subtest, 90)
            : await apiRef.current.getRecentItems(subtest);
          return new Set(recent.map((r) => r.itemRef));
        } catch {
          return undefined;
        }
      };
      const [
        wordExclude,
        sentExclude,
        namingExclude,
        repeatExclude,
        readingExclude,
        spellPriority,
      ] = await Promise.all([
        wordCount > 0 ? fetchExclude('word') : Promise.resolve(undefined),
        sentenceCount > 0
          ? fetchExclude('sentence')
          : Promise.resolve(undefined),
        namingCount > 0
          ? fetchExclude('naming')
          : Promise.resolve(undefined),
        repeatCount > 0
          ? fetchExclude('repeat')
          : Promise.resolve(undefined),
        readingCount > 0
          ? fetchExclude('reading')
          : Promise.resolve(undefined),
        spellCount > 0
          ? apiRef.current
              .getRecentItems('spell')
              .then((recent) => recent.map((r) => asItemRef(r.itemRef)))
              .catch((): SpellItemRef[] => [])
          : Promise.resolve<SpellItemRef[]>([]),
      ]);
      // 낱말과 문장은 화면에선 같은 종류('듣고 그림 고르기')지만 하위검사로는
      // 별개다. 로테이션이 둘 중 무엇을 낼지 정하므로 각 풀에서 따로 뽑는다.
      const qabItems: PlayableItem[] = [
        ...pickWordRef.current(wordCount, levels?.word, {
          exclude: wordExclude,
        }),
        ...pickSentRef.current(sentenceCount, levels?.sentence, {
          exclude: sentExclude,
        }),
      ].map((it) => ({ kind: 'qab', id: it.itemId, item: it }));
      // 이름대기는 비레벨 검사다 — levels.naming을 넘기지 않는다.
      const namingItems: PlayableItem[] = pickNamingRef
        .current(namingCount, { exclude: namingExclude })
        .map((it) => ({ kind: 'naming', id: it.itemId, item: it }));
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
        .current(repeatCount, levels?.repeat, { exclude: repeatExclude })
        .map((it) => ({ kind: 'repeat', id: it.itemId, item: it }));
      const readingItems: PlayableItem[] = pickReadingRef
        .current(readingCount, levels?.reading, { exclude: readingExclude })
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
      startLevelsRef.current = levels ?? {};
      subtestTrailRef.current = new Map();
      spellExcludeRef.current = spokenWords;

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

  /**
   * 그 검사의 문항을 `need`개 새로 뽑는다 — 이미 낸 것은 피한다.
   *
   * **`need`보다 많이 요청하지 않는다.** 뱅크의 폴백은 후보가 모자라면 "세션이
   * 비는 것보다 낫다"며 레벨 범위를 풀어 버린다. 중복을 피하려고 넉넉히 달라고
   * 하면 그 폴백을 밟아 밴드가 섞이고, 방금 바꾼 레벨이 거짓이 된다. 그래서
   * 같은 개수로 여러 번 뽑아 안 쓴 것만 모은다.
   */
  const drawFor = useCallback(
    (subtest: QabSubtest, level: number, need: number, used: Set<string>) => {
      const draw = (n: number): PlayableItem[] => {
        switch (subtest) {
          // 레벨이 바뀌어 다시 뽑는 소수 문항이라, 세션 시작 때 조회한
          // 겹침 방지 exclude는 여기까지 안 넘긴다(word·sentence·repeat·
          // reading 전부) — `used`가 이미 이번 세션 안의 중복은 막는다.
          // spell의 재출제(priority)도 같은 이유로 이 redraw까지는 안 간다
          // (spokenWords exclude만 간다).
          case 'word':
            return pickWordRef.current(n, level).map((it) => ({
              kind: 'qab' as const, id: it.itemId, item: it,
            }));
          case 'sentence':
            return pickSentRef.current(n, level).map((it) => ({
              kind: 'qab' as const, id: it.itemId, item: it,
            }));
          case 'spell':
            return pickSpellRef.current(n, level, {
              exclude: spellExcludeRef.current,
            }).map((it) => ({ kind: 'spell' as const, id: it.itemId, item: it }));
          case 'repeat':
            return pickRepeatRef.current(n, level).map((it) => ({
              kind: 'repeat' as const, id: it.itemId, item: it,
            }));
          case 'reading':
            return pickReadingRef.current(n, level).map((it) => ({
              kind: 'reading' as const, id: it.itemId, item: it,
            }));
          case 'ddk':
            return pickDdkRef.current(n, level).map((it) => ({
              kind: 'ddk' as const, id: it.itemId, item: it,
            }));
          default:
            // naming은 비레벨(E1), loc는 문항이 없다.
            return [];
        }
      };

      const out: PlayableItem[] = [];
      const seen = new Set(used);
      for (let attempt = 0; attempt < 5 && out.length < need; attempt += 1) {
        for (const it of draw(need)) {
          if (out.length >= need) break;
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          out.push(it);
        }
      }
      return out;
    },
    [],
  );

  /**
   * 적응이 걸리면 **그 검사의 아직 안 푼 문항**을 새 레벨로 갈아끼운다.
   *
   * 지금 화면에 떠 있는 문항은 건드리지 않는다 — 답하는 도중에 문제가 바뀌면
   * 환자에게는 앱이 고장 난 것으로 보인다. 다음 문항부터 적용된다.
   *
   * 새로 못 뽑으면(밴드가 바닥) 남은 문항을 그대로 둔다. 같은 문항을 두 번 내면
   * 세션 안에서 문항 식별자가 겹쳐 결과 한 건이 사라진다.
   */
  const repickRemaining = useCallback(
    (subtest: QabSubtest, level: number): void => {
      const items = itemsRef.current;
      const targets: number[] = [];
      for (let i = indexRef.current + 1; i < items.length; i += 1) {
        if (playableSubtest(items[i]) === subtest) targets.push(i);
      }
      if (targets.length === 0) return;

      const used = new Set(items.map((it) => it.id));
      const fresh = drawFor(subtest, level, targets.length, used);
      if (fresh.length < targets.length) {
        console.warn(
          `[quiz] ${subtest} 레벨 ${level} 후보가 부족해 ${targets.length - fresh.length}문항은 이전 레벨로 남는다`,
        );
      }
      for (let k = 0; k < fresh.length; k += 1) items[targets[k]] = fresh[k];
    },
    [drawFor],
  );

  /**
   * 이번 답을 검사별 기록에 넣고, 규칙이 걸리면 남은 문항의 눈높이를 바꾼다.
   *
   * 보호자가 넘긴 문항(assisted)은 기록에 넣지 않는다 — 환자가 맞힌 게 아니다.
   */
  const recordForAdaptation = useCallback(
    (item: PlayableItem, isCorrect: boolean, assisted: boolean): void => {
      if (assisted) return;
      const subtest = playableSubtest(item);
      if (subtest === null || subtest === 'naming') return;

      const trail = [...(subtestTrailRef.current.get(subtest) ?? []), isCorrect];
      subtestTrailRef.current.set(subtest, trail);

      const start = startLevelsRef.current[subtest];
      if (start === undefined) return;
      const before = adaptedLevel(start, trail.slice(0, -1));
      const after = adaptedLevel(start, trail);
      if (after !== before) repickRemaining(subtest, after);
    },
    [repickRemaining],
  );

  /** 채점 결과를 반영해 feedback 단계로 전이 (공통). */
  /**
   * 로그 끝에서부터 연속 오답 수(피로 탈출 판정용).
   *
   * 도움받은 문항은 **투명하게 지나친다** — 환자가 맞힌 게 아니니 연속을 끊지 않고,
   * 환자가 틀린 것도 아니니 세지도 않는다. 끊어 버리면 힘들어서 넘긴 상황에서
   * 안전장치가 꺼진다.
   */
  const trailingWrong = (): number => {
    const log = recentCorrectRef.current;
    let n = 0;
    for (let i = log.length - 1; i >= 0; i -= 1) {
      if (log[i].assisted) continue;
      // 채점 불가도 투명하게 지나친다. 좌절의 근거는 "틀렸다"이지 "못 쟀다"가
      // 아니고, 그렇다고 못 잰 문항이 앞선 연속 오답을 지워 주지도 않는다.
      if (log[i].isCorrect === null) continue;
      if (log[i].isCorrect) break;
      n += 1;
    }
    return n;
  };

  const applyResult = useCallback(
    (
      result: PlayResult,
      selectedChoiceId: string | null,
      assisted = false,
    ): void => {
      const item = itemsRef.current[indexRef.current];
      // 채점 불가는 적응의 근거가 아니다 — 맞힌 것도 틀린 것도 아니라서
      // 승급·강등 어느 쪽으로도 세면 안 된다. 로그에는 null로 남긴다.
      if (item && result.isCorrect !== null) {
        recordForAdaptation(item, result.isCorrect, assisted);
      }
      recentCorrectRef.current.push({ isCorrect: result.isCorrect, assisted });
      phaseRef.current = 'feedback';
      setState((prev) => ({
        ...prev,
        phase: 'feedback',
        lastResult: result,
        selectedChoiceId,
      }));
    },
    [recordForAdaptation],
  );

  const submitDaily = useCallback(
    async (userAnswer: string, assisted = false): Promise<void> => {
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
          assisted,
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
    (choiceId: string, ctx?: { unheard?: boolean }): void => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== 'qab') return;

      const chosen = item.item.choices.find((c) => c.choiceId === choiceId);
      const correct = item.item.choices.find((c) => c.isCorrect);
      const isCorrect = chosen?.isCorrect ?? false;
      // **소리가 안 났으면 잰 것이 없다.** 듣고 그림을 고르는 과제라, 못 들은
      // 채 고른 답은 이해력이 아니라 찍기다. `assisted`가 아니라 `unscored`인
      // 이유는 보호자가 아무것도 안 했기 때문이다 — 보호자 화면의 "도움 N회"가
      // 거짓이 되면 그 통계로 정답률을 거르는 곳이 같이 오염된다.
      // unscored 규약대로 isCorrect는 false로 보낸다(값에 뜻이 없다).
      const unheard = ctx?.unheard === true;
      pushAnswered(qabResultsRef, {
        subtest: item.item.category,
        itemRef: item.item.itemId,
        isCorrect: unheard ? false : isCorrect,
        ...(unheard ? { unscored: true } : {}),
        ...observed(item.item),
        // 틀렸을 때만, 그리고 갈래를 아는 선택지일 때만 보낸다. 단어이해
        // 선택지는 뱅크가 뽑으면서 갈래를 붙여 두고(QabFoilKind), 문장이해는
        // 선택지가 JSON 고정 쌍이라 갈래가 없다.
        // 채점 불가면 갈래도 안 보낸다 — 오답 갈래는 "무엇을 헷갈렸나"인데
        // 못 들은 찍기에는 헷갈릴 대상이 없다.
        ...(!unheard && !isCorrect && chosen?.foilKind !== undefined
          ? { foilKind: chosen.foilKind }
          : {}),
      });
      applyResult(
        {
          // 못 들었으면 정오답을 말하지 않는다 — 발화 채점 불가와 같은 대우다.
          isCorrect: unheard ? null : isCorrect,
          correctLabel: correct?.label ?? null,
        },
        choiceId,
      );
    },
    [applyResult],
  );

  /**
   * 발화 문항(이름대기·따라말하기·읽기)의 채점 결과를 기록하고 피드백을 낸다.
   *
   * 세 곳이 같은 규칙을 써야 하므로 한곳에 모은다 — 어긋나면 그게 곧 폴백이다.
   * 채점 불가여도 **행은 남긴다.** 채점 실패율을 아무도 못 보면 조용히 망가진다.
   */
  const applySpeechAssessment = useCallback(
    (
      assessment: SpeechAssessment,
      opts: {
        subtest: QabResultInput['subtest'];
        itemRef: string;
        correctLabel: string;
        extra?: Partial<QabResultInput>;
      },
    ): void => {
      const extra = opts.extra ?? {};
      if (!assessment.scored) {
        pushAnswered(qabResultsRef, {
          ...extra,
          subtest: opts.subtest,
          itemRef: opts.itemRef,
          isCorrect: false,
          unscored: true,
        });
        applyResult(
          {
            isCorrect: null,
            correctLabel: opts.correctLabel,
            encouragement: assessment.encouragement,
          },
          null,
        );
        return;
      }
      pushAnswered(qabResultsRef, {
        ...extra,
        subtest: opts.subtest,
        itemRef: opts.itemRef,
        isCorrect: assessment.isCorrect,
        score: assessment.score,
        // 관측용 — 채점에는 안 쓴다(위 score가 이미 확정된 채점 결과다).
        accuracyScore: assessment.accuracyScore,
        completenessScore: assessment.completenessScore,
        fluencyScore: assessment.fluencyScore,
      });
      applyResult(
        {
          isCorrect: assessment.isCorrect,
          correctLabel: opts.correctLabel,
          grade: assessment.grade,
          encouragement: assessment.encouragement,
        },
        null,
      );
    },
    [applyResult],
  );

  const submitNaming = useCallback(
    (
      transcript: string,
      azure: AzurePronunciationScores | null = null,
      /** 몇 단계까지 단서를 받고 답했나(E18). 0이면 무단서. */
      cueLevel: number = CUE_NONE,
    ): void => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== 'naming') return;

      // 음소 점수로만 채점한다. 없으면 채점 불가 — 예전의 문자열 근접도
      // (isNameMatch) 폴백은 없앴다. 단어 STT는 실측 CER 0.70이라 그 폴백이
      // 실제로는 "STT가 알아들었나"를 재고 있었다.
      applySpeechAssessment(evaluateFromAzure(azure, transcript, 'word'), {
        subtest: 'naming',
        itemRef: item.item.itemId,
        correctLabel: item.item.targetWord,
        extra: {
          cueLevel,
          // 단서를 받았으면 도움받음이다. 기존 통계가 `NOT assisted`로 걸러
          // 정답률을 내므로, 여기서 참으로 두지 않으면 단서받은 정답이
          // 무단서 정답과 같은 값에 섞인다.
          ...(cueLevel >= CUE_SEMANTIC ? { assisted: true } : {}),
          ...observed(item.item),
        },
      });
    },
    [applySpeechAssessment],
  );

  const submitSpeech = useCallback(
    (
      transcript: string,
      azure: AzurePronunciationScores | null = null,
      ctx?: { unheard?: boolean },
    ): void => {
      if (phaseRef.current !== 'answering') return;
      const item = itemsRef.current[indexRef.current];
      if (!item) return;

      // 모범을 못 들었으면 채점하지 않는다. 따라말하기는 **들은 것을 붙드는**
      // 과제라, 못 들은 채 낸 발화는 잘 말했든 아니든 그 능력을 안 잰다.
      // 읽기는 자극이 글이라 여기 안 걸린다(컴포넌트가 늘 false를 보낸다).
      const unheard = ctx?.unheard === true;

      if (item.kind === 'repeat') {
        const mode = item.item.category === 'sentence' ? 'sentence' : 'word';
        const assessment = unheard
          ? UNSCORED
          : evaluateFromAzure(azure, transcript, mode);
        applySpeechAssessment(assessment, {
          subtest: 'repeat',
          itemRef: item.item.itemId,
          correctLabel: item.item.text,
          extra: observed(item.item),
        });
        return;
      }
      if (item.kind === 'reading') {
        applySpeechAssessment(evaluateFromAzure(azure, transcript, 'sentence'), {
          subtest: 'reading',
          itemRef: item.item.itemId,
          correctLabel: item.item.text,
          extra: observed(item.item),
        });
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
      pushAnswered(qabResultsRef, {
        subtest: 'spell',
        itemRef: item.item.itemId,
        isCorrect: correct,
        ...observed(item.item),
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
      pushAnswered(qabResultsRef, {
        subtest: 'ddk',
        itemRef: item.item.itemId,
        isCorrect: correct,
        metric: count,
        ...observed(item.item),
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
    pushAnswered(qabResultsRef, {
      subtest,
      itemRef: item.id,
      isCorrect: true,
      assisted: true,
      // 이름대기에서 넘어가기는 **사다리의 꼭대기**다(정답을 알려줬다).
      // 다른 검사에는 단서 개념이 없어 값을 안 남긴다.
      ...(subtest === 'naming' ? { cueLevel: CUE_GIVEN } : {}),
    });
    applyResult({ isCorrect: true, correctLabel }, null, true);
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
  /** 검사별 세션 종료 눈높이 — 시작 레벨에 이번 세션 기록을 적용한 값. */
  const sessionEndingLevels = useCallback(():
    | Partial<Record<QabSubtest, number>>
    | undefined => {
    const out: Partial<Record<QabSubtest, number>> = {};
    for (const [subtest, trail] of subtestTrailRef.current) {
      const start = startLevelsRef.current[subtest];
      if (start === undefined) continue;
      out[subtest] = adaptedLevel(start, trail);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, []);

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
    // 세션이 끝날 때만 눈높이를 보고한다. 세션 내 적응이 실제로 도달한 값이고,
    // 서버는 이 값을 저장된 레벨 ±1로 접어 받는다.
    const endingLevels = completed ? sessionEndingLevels() : undefined;
    void Promise.resolve(
      apiRef.current.submitQabResults(
        sessionTokenRef.current,
        pending,
        manifestVersionRef.current,
        completed,
        endingLevels,
      ),
    )
      .then(() => {
        submittedCountRef.current = targetCount;
      })
      .catch((err) => {
        // 저장 실패는 환자 경험을 막지 않는다. 이 세션이 계속되면 다음
        // flush에서 이 tail이 그대로 다시 실린다(submittedCountRef 미변경).
        console.warn('[quiz] QAB 결과 점진 저장 실패:', err);
        // 화면 이탈로 이 훅이 언마운트되면 "다음 flush"가 영영 안 온다 —
        // 그게 이 시도의 마지막 기회일 수 있다. 재부팅 후에도 재시도되도록
        // 대기열에 durable하게 남긴다(R7, 계획 2-2A). 네트워크를 다시
        // 부르지 않는다 — 저장만 하고 실제 재시도는 로그인 시점에 일어난다.
        enqueueQabOutbox(
          sessionTokenRef.current,
          pending,
          manifestVersionRef.current,
          completed,
          endingLevels,
        );
      });
  }, [sessionEndingLevels]);

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
      // 점수 분모는 **환자가 실제로 푼 문항 수**다.
      //
      //  - 피로 탈출 시 안 푼 문항까지 오답으로 세면(0/10) 배려로 끝낸 세션이
      //    되레 좌절을 준다 — 조기 종료의 목적과 반대.
      //  - 보호자가 넘긴 문항은 분자·분모 **양쪽에서** 뺀다. 정답으로 세면 점수가
      //    100점까지 부풀고, 오답으로 세면 도움을 처벌하는 셈이 된다.
      // 분모는 **실제로 채점된 문항 수**다. 셋이 빠진다.
      //  - 피로 탈출로 안 푼 문항: 오답으로 세면(0/10) 배려로 끝낸 세션이
      //    되레 좌절을 준다 — 조기 종료의 목적과 반대다.
      //  - 보호자가 넘어가기로 통과시킨 문항(assisted): 환자 수행이 아니다.
      //  - 채점 불가(isCorrect === null): 못 잰 것을 오답으로 세면 채점기가
      //    흔들린 날마다 환자 점수가 떨어진다.
      const answered = recentCorrectRef.current.filter(
        (e) => !e.assisted && e.isCorrect !== null,
      );
      const attempted = answered.length;
      const correct = answered.filter((e) => e.isCorrect).length;
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
    // 채점 불가였다면 값이 같아도 적용한다 — 저장된 false는 판정이 아니라
    // 자리표시였고, 여기서 처음으로 "오답"이라는 판정이 생긴다.
    if (last.isCorrect === isCorrect && !last.unscored) return; // 변화 없음
    last.isCorrect = isCorrect;
    // 사람이 직접 듣고 낸 판정이라 "다른 것을 재는" 문제가 없다. 정확도 집계에
    // 들어간다. 점수(score)는 여전히 없다 — 사람은 정오답을 말했지 0~100점을
    // 말한 게 아니다.
    delete last.unscored;
    // 로그의 마지막 항목도 함께 뒤집는다 — 점수·연속오답이 정정을 반영하게.
    // (안 고치면 정정된 정답인데도 연속오답으로 남아 피로 탈출이 잘못 발동.)
    const log = recentCorrectRef.current;
    if (log.length > 0) log[log.length - 1].isCorrect = isCorrect;
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
