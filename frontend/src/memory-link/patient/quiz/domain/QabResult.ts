// QAB 검사 결과/요약 도메인 타입 (백엔드 계약 미러)
//
// 백엔드: POST /quiz/qab-results, GET /quiz/qab-summary
// 환자가 푼 QAB 문항 결과를 저장하고, 보호자가 검사별 회복 추세를 본다.

import type { ScorerVersion, UnscoredReason } from './neighborScoring.js';

/** QAB 검사 하위 종류 */
export type QabSubtest =
  | 'word'
  | 'sentence'
  | 'naming'
  | 'repeat'
  | 'reading'
  /** 글자 조합 — 음절 타일을 눌러 목표 단어를 만든다(산출 과제). */
  | 'spell'
  | 'ddk'
  /** 의식 수준. 문항 정오답이 아니라 반응시간으로 0~3점을 매긴다. */
  | 'loc';

/** 제출용 단일 결과 (세션 완료 시 일괄 전송) */
export interface QabResultInput {
  subtest: QabSubtest;
  /** 프론트 문항 식별자 (추적용) */
  itemRef: string;
  isCorrect: boolean;
  /** 보호자가 "넘어가기"로 통과시킨 문항이면 true. 정확도 집계에서 제외 */
  assisted?: boolean;
  /**
   * 채점 불가 — 음향 발음 평가를 얻지 못해 판정을 내리지 않은 문항.
   *
   * assisted와 다르다. assisted는 "보호자가 도와서 통과시켰다"이고, unscored는
   * "잴 수 없었다"이다. true면 isCorrect는 의미가 없고(false로 보낸다) 서버가
   * 정확도 분모·발음 평균·레벨링 윈도우에서 모두 제외한다.
   */
  unscored?: boolean;
  /**
   * 채점 불가의 이유. `unscored`가 true일 때만 의미가 있다(서버가 아니면 지운다).
   * `no_score` = 채점 서버에 못 닿았거나 인식 결과가 없다, `ambiguous` = 재시도까지 했지만 목표와
   * 가까운 다른 단어를 못 가렸다. 이웃 비교로 채점한 시도에서만 보낸다.
   */
  unscoredReason?: UnscoredReason;
  /**
   * 이 문항을 채점한 채점기 버전. 안 보내면 서버가 NULL로 남기고 그건 `azure-pa-v1`이다.
   * 점수는 채점기에 묶여서, 진전 추이는 같은 버전 안에서만 잇는다.
   */
  scorerVersion?: ScorerVersion;
  /**
   * 이웃 비교에서 **다시 말하게 한 횟수**(이름대기만). 안 거친 시도는 **생략**한다 — 0과 다르다.
   * 1차 모호율("한 번 더"를 얼마나 자주 듣나)의 분자·분모가 이 값이다.
   */
  ambiguousRetries?: number;

  /**
   * 이름대기에서 **몇 단계까지 단서를 받고 답했나**(E18).
   *
   *   0 무단서 · 1 의미 · (2 문장 완성 — 미구현) · 3 음소 · 4 통과
   *
   * `assisted`를 대체하지 않는다. 1 이상이면 둘 다 참으로 보낸다 — 기존 통계가
   * `assisted`로 정답률을 거르고 있어 그 뜻을 유지해야 한다. 이름대기 외의
   * 검사에는 단서 개념이 없어 서버가 떨군다.
   */
  cueLevel?: number;
  /** 수치 지표(ddk 감지 횟수 등). 없으면 생략 */
  metric?: number;
  /**
   * 점수. 두 가지 용도로 쓴다(subtest가 구분한다).
   *  - repeat/reading: 발음 정확도 0~100
   *  - loc: 그 시도의 의식 수준 점수 0~3
   * 집계가 GROUP BY subtest라 서로 섞이지 않는다.
   */
  score?: number;
  /**
   * 발음 세부 점수(0~100) — repeat/reading에서만, 채점됐을 때만 보낸다.
   *
   * `score`(종합점수)를 만드는 데 실제로 쓰이는 값이지만 계산 후 버려지고
   * 있었다. **채점에 다시 쓰지 않는다** — 관측용이고, 종합점수 가중치를
   * 나중에 조정하려면 먼저 이 값들이 쌓여야 한다.
   */
  accuracyScore?: number;
  completenessScore?: number;
  fluencyScore?: number;
  /**
   * 이 항목이 제시된 난이도 레벨(1~5). 세션 내 적응(D7-C) 이후로는 프론트가
   * **실제로 낸 값**이다. 서버는 저장된 레벨 ±1로 접어 받는다.
   */
  presentedLevel?: number;
  /**
   * 이 문항이 **레벨이 요구한 밴드 밖**에서 왔는가.
   *
   * 뱅크는 후보가 모자라면 범위를 풀어 세션이 비지 않게 한다. 옳은 선택이지만
   * 그렇게 나온 문항의 `presentedLevel`은 실제 난이도를 뜻하지 않는다. 표시하지
   * 않으면 레벨별 집계가 조용히 틀린 채로 남는다 — 어느 행이 믿을 수 있는지
   * 구분할 방법이 없다.
   *
   * `foil_kind`와 같은 성격이다: **관측용이고 채점에 안 쓴다.**
   */
  bandFallback?: boolean;
  /**
   * 이름대기에서 제시된 그림이 **실물 사진인지 아이콘(SVG)인지.**
   *
   * 자극의 33%(30/91)가 사진이 없어 SVG로 떨어진다. 둘은 이름을 떠올리는 난이도가
   * 달라서, 안 남기면 이름대기 정답률이 무엇을 재는 값인지 알 수 없다.
   */
  stimulusKind?: 'photo' | 'svg';
  /**
   * 틀렸을 때 **어느 갈래의 오답을 골랐는가** — 단어이해에만 붙는다.
   *
   * 정답률 하나로는 "무엇이 어려운지"를 말할 수 없다. 의미 오답('사과'에 대한
   * '바나나')을 반복해 고르는 것과 음운 오답('사자')을 반복해 고르는 것은 서로
   * 다른 손상이다. 맞혔거나 갈래를 모르면 생략한다.
   *
   * **채점에 쓰지 않는다.** 정확도·레벨 재계산은 이 값을 보지 않는다 —
   * 관측용이라 클라이언트가 보내도 측정이 흔들리지 않는다.
   */
  foilKind?: 'semantic' | 'phonological' | 'unrelated';
  /**
   * 이 문항을 **푼** 시각(ISO 8601, UTC). `stampAnswered`로 결과가 생기는
   * 자리에서 찍는다.
   *
   * 보내는 시각이 아니다. 제출이 실패해 나중에 다시 보내져도 푼 날로 센다.
   * 서버는 `[지금 − 24h, 지금]`으로 접고, 없으면 서버 시각을 쓴다.
   */
  answeredAt?: string;
}

/**
 * 결과에 **푼 시각**을 찍는다(계획 OV-B). 결과가 생기는 그 자리에서 불러야
 * 한다 — 보낼 때 찍으면 재전송 대기열에 머문 만큼 늦은 날로 저장된다.
 *
 * 이미 찍혀 있으면 덮지 않는다. 재전송이 원래 시각을 지키게 하려는 것이다.
 * `toISOString()`은 늘 UTC(`Z`)라 서버의 시간대 필수 검사를 통과한다.
 */
export function stampAnswered(
  result: QabResultInput,
  at: Date = new Date(),
): QabResultInput {
  if (result.answeredAt !== undefined) return result;
  return { ...result, answeredAt: at.toISOString() };
}

/**
 * GET /quiz/skill-levels 응답 — 스킬별 현재 난이도 레벨(콜드스타트 2 채움) +
 * 정적 문항 풀 매니페스트 버전. 프론트가 이 레벨로 문항 선택 난이도를 정한다.
 * 레벨은 환자에게 노출하지 않는다(강등 비가시).
 */
export interface SkillLevels {
  levels: Record<QabSubtest, number>;
  manifestVersion: number;
}

/** 검사별 회복 추적 요약 (보호자용) */
export interface QabSubtestSummary {
  subtest: string;
  /** 보호자 도움(넘어가기) 제외한 실제 응답 수 */
  total: number;
  correct: number;
  /** 0..100 정확도 (도움 제외 기준) */
  accuracy: number;
  /** 보호자가 넘어가기로 통과시킨 문항 수 */
  assisted: number;
  /**
   * 채점하지 못한 문항 수(total에 포함되지 않는다). 오답이 아니라 측정 실패다.
   * 이 수가 커지면 정확도가 아니라 **채점 경로**를 의심해야 한다.
   */
  unscored: number;
  avgMetric: number | null;
  maxMetric: number | null;
  /** 발음 정확도 평균(0..100). 발화 기록 없으면 null */
  avgScore: number | null;
  lastAt: string | null;
  /**
   * 오답을 갈래별로 센 것 — 단어 이해에만 값이 있다. 없으면 null.
   *
   * **음운 유인지는 눈높이 4단계부터 나온다.** 그 아래에서는 고를 기회 자체가
   * 없어 `phonological: 0`이 "소리는 괜찮다"를 뜻하지 않는다. 화면은 이 사실을
   * 같이 말해야 한다.
   */
  foilKinds?: {
    semantic: number;
    phonological: number;
    unrelated: number;
  } | null;
  /**
   * 이름대기에서 **평균 몇 칸을 도왔나**(E18). 0에 가까울수록 스스로 한다.
   * 표본이 없으면 null.
   *
   *   0 무단서 · 1 의미 단서 · 3 음소 단서 · 4 정답을 알려줌
   */
  avgCueLevel?: number | null;
  /** 위 평균이 몇 문항에서 나왔나. 이 기능 이전의 기록은 안 들어간다. */
  cueScored?: number;
}

/** 한 검사의 특정 주차 성적 (백엔드 QabWeeklyPoint 미러) */
export interface QabWeeklyPoint {
  /** 그 주 월요일 (YYYY-MM-DD) */
  weekStart: string;
  total: number;
  correct: number;
  /** 0~100. loc는 정답률이 아니라 반응률이다. */
  accuracy: number;
  /** loc 의식 점수(0~3) 또는 발화 발음 점수(0~100). 없으면 null. */
  avgScore: number | null;
  /** ddk 평균 감지 횟수. 이해·발화 검사는 null. */
  avgMetric: number | null;
}

/** 검사별 주차 추이 */
export interface QabTrendSeries {
  subtest: string;
  /** 오래된 주부터 */
  points: QabWeeklyPoint[];
  /** 직전 검사 주 대비 정답률 변화(%p). 주가 2개 미만이면 null. */
  deltaFromPrevious: number | null;
}

/**
 * GET /quiz/session-stats 응답 — 최근 N일 세션 완료율(보호자용).
 *
 * 시작한 세션 = 문항 결과가 하나라도 남은 세션. 완료 = 자연 종료·피로 탈출로
 * 끝나 완료 마커가 찍힌 세션. 중간에 화면을 닫은 세션은 결과는 남지만 마커가
 * 없어 '이탈'로 잡힌다.
 */
export interface SessionStats {
  started: number;
  completed: number;
  /** 0..100. started가 0이면 null(비율을 지어내지 않는다). */
  completionRate: number | null;
  /** 이탈 세션이 평균 몇 문항까지 갔는지(소수 1자리). 이탈이 없으면 null. */
  avgItemsBeforeDropoff: number | null;
}

/**
 * GET /quiz/recent-items 응답 1건 — 문항 재출제 우선순위 산출용.
 *
 * 실어증 치료 이득은 훈련한 그 항목을 크게 넘어가지 않는다(limited transfer).
 * 최근에 틀린 문항을 다시 내야 반복 훈련이 성립한다.
 */
export interface RecentItem {
  itemRef: string;
  /** 최근 기간에 한 번이라도 맞혔는가. false면 재출제 우선순위가 높다. */
  /**
   * 가장 최근 시도의 정오답. "한 번이라도 맞았나"가 아니다.
   *
   * 후자를 쓰면 오래전에 한 번 맞히고 어제 틀린 문항이 "맞힌 것"으로 분류돼
   * 우선순위 맨 뒤로 밀린다 — 반복 훈련이 정확히 거꾸로 동작한다.
   */
  lastCorrect: boolean;
  lastAt: string;
}

