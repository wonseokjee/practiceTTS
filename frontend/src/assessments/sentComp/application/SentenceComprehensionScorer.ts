/**
 * 문장 이해 (SentComp) 검사 - 도메인 채점 서비스
 *
 * 외부 의존성이 없는 순수 함수로 구성된다.
 * 입력만으로 출력이 결정되므로 테스트 가능성이 높다.
 *
 * 채점 규칙:
 * - totalScore = Math.round(correctCount / totalItems * 100)
 * - byType별 rate = total === 0 ? null : correct / total
 * - averageReactionTimeMs: 전체 결과의 reactionTimeMs 평균 (결과 없으면 0)
 * - averageReplayCount: 전체 결과의 replayCount 평균 (결과 없으면 0)
 */

import type {
  SentenceComprehensionItem,
  SentenceComprehensionResult,
  SentenceComprehensionScore,
  SentenceType,
  SentenceTypeStats,
} from '../domain/types.js';

/**
 * 선택한 이미지 인덱스가 정답인지 판정한다.
 *
 * @param item - 문항 데이터
 * @param selectedIndex - 사용자가 선택한 이미지 인덱스 (0 또는 1)
 * @returns 정답 여부
 */
export function isAnswerCorrect(
  item: SentenceComprehensionItem,
  selectedIndex: 0 | 1,
): boolean {
  return item.choices[selectedIndex].isCorrect;
}

/**
 * 반응 시간을 계산한다.
 * 선택 시각이 오디오 종료 시각보다 앞설 수 없으므로 음수는 0으로 처리한다.
 *
 * @param audioEndTimestamp - 오디오 재생 완료 시각 (performance.now() 기준)
 * @param selectionTimestamp - 이미지 선택 시각 (performance.now() 기준)
 * @returns 반응 시간 (ms), 최소 0
 */
export function calculateReactionTime(
  audioEndTimestamp: number,
  selectionTimestamp: number,
): number {
  return Math.max(0, selectionTimestamp - audioEndTimestamp);
}

/**
 * 전체 검사 결과를 채점하여 SentenceComprehensionScore를 반환한다.
 *
 * @param items - 전체 문항 목록 (byType 통계 집계에 사용)
 * @param results - 제출된 응답 결과 목록
 * @returns 채점 결과
 */
export function calculateScore(
  items: SentenceComprehensionItem[],
  results: SentenceComprehensionResult[],
): SentenceComprehensionScore {
  const totalItems = items.length;
  const correctCount = results.filter((r) => r.isCorrect).length;

  const totalScore =
    totalItems > 0 ? Math.round((correctCount / totalItems) * 100) : 0;

  // byType 통계: 모든 문장 유형을 초기화 후 집계
  const sentenceTypes: SentenceType[] = [
    'reversible',
    'relative-clause',
    'embedded-clause',
  ];

  // 문항 ID → 문장 유형 맵 생성
  const itemTypeMap = new Map<string, SentenceType>();
  for (const item of items) {
    itemTypeMap.set(item.itemId, item.sentenceType);
  }

  // 유형별 집계 초기화
  const typeAccumulator: Record<SentenceType, { total: number; correct: number }> =
    {
      'reversible': { total: 0, correct: 0 },
      'relative-clause': { total: 0, correct: 0 },
      'embedded-clause': { total: 0, correct: 0 },
    };

  // 문항 목록 기준으로 total 집계 (결과가 없는 문항도 포함)
  for (const item of items) {
    typeAccumulator[item.sentenceType].total += 1;
  }

  // 응답 결과 기준으로 correct 집계
  for (const result of results) {
    const sentenceType = itemTypeMap.get(result.itemId);
    if (sentenceType !== undefined) {
      if (result.isCorrect) {
        typeAccumulator[sentenceType].correct += 1;
      }
    }
  }

  // SentenceTypeStats 변환
  const byType: Record<SentenceType, SentenceTypeStats> = {} as Record<
    SentenceType,
    SentenceTypeStats
  >;

  for (const sentenceType of sentenceTypes) {
    const acc = typeAccumulator[sentenceType];
    byType[sentenceType] = {
      total: acc.total,
      correct: acc.correct,
      rate: acc.total === 0 ? null : acc.correct / acc.total,
    };
  }

  // 평균 반응시간 계산
  const averageReactionTimeMs =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.reactionTimeMs, 0) / results.length
      : 0;

  // 평균 재청취 횟수 계산
  const averageReplayCount =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.replayCount, 0) / results.length
      : 0;

  return Object.freeze({
    totalItems,
    correctCount,
    totalScore,
    byType,
    averageReactionTimeMs,
    averageReplayCount,
  });
}
