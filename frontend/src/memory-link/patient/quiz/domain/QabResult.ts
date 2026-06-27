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
  | 'ddk';

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
  lastAt: string | null;
}
