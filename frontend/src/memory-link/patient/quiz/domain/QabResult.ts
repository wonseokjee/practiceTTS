// QAB 검사 결과/요약 도메인 타입 (백엔드 계약 미러)
//
// 백엔드: POST /quiz/qab-results, GET /quiz/qab-summary
// 환자가 푼 QAB 문항 결과를 저장하고, 보호자가 검사별 회복 추세를 본다.

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

