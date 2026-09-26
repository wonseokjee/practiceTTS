/**
 * 발화 채점기 버전 — 점수는 채점기에 묶인다.
 *
 * - `azure-pa-v1`: Azure 발음 평가 하나로 채점(`accuracy ≥ 60`이면 정답). 이 컬럼이 생기기
 *   전의 모든 행이 이것이다(컬럼 NULL = 이 값).
 * - `azure-pa-nbr-v1`: 이웃 비교 채점. 목표와 소리가 가까운 다른 단어(이웃)와 후보 없는
 *   인식 결과를 같이 채점해 정답·모호·오답으로 가른다. 모호는 1회 재시도, 다시 모호하면
 *   채점 불가(`ambiguous`).
 *
 * 채점기를 바꾸면 같은 환자의 같은 수행이 다른 점수를 받는다. 그래서 진전 추이는 **같은
 * 버전 안에서만** 잇는다(음향 채점 계획 7절). 버전을 늘릴 때는 여기와 프론트 상수를 함께
 * 늘린다 — 목록에 없는 값은 DTO가 거부한다.
 */
export const QAB_SCORER_VERSIONS = ['azure-pa-v1', 'azure-pa-nbr-v1'] as const;

export type QabScorerVersion = (typeof QAB_SCORER_VERSIONS)[number];

/** 컬럼 이전의 행(NULL)이 뜻하는 버전. 소급해서 채우지 않고 읽을 때 해석한다. */
export const QAB_LEGACY_SCORER_VERSION: QabScorerVersion = 'azure-pa-v1';

/**
 * 채점 불가(`unscored`)의 이유.
 *
 * - `no_score`: 채점 서버에 못 닿았거나 인식 결과가 없다. 이 컬럼 이전의 유일한 이유였다.
 * - `ambiguous`: 재시도까지 했지만 목표와 가까운 다른 단어를 가르지 못했다(이웃 비교).
 *
 * 값이 갈려야 문턱을 조정할 근거가 생긴다 — `no_score`가 늘면 채점 경로를, `ambiguous`가
 * 늘면 판정 규칙을 의심한다.
 */
export const QAB_UNSCORED_REASONS = ['no_score', 'ambiguous'] as const;

export type QabUnscoredReason = (typeof QAB_UNSCORED_REASONS)[number];
