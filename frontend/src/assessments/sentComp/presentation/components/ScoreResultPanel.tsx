/**
 * 채점 결과 패널 컴포넌트
 *
 * 총점, 문장 유형별 정답률 테이블,
 * 평균 반응시간, 평균 재청취 횟수를 표시한다.
 */

import type React from 'react';
import type { ScoreDTO } from '../../application/dtos.js';

interface ScoreResultPanelProps {
  /** 채점 결과 DTO */
  score: ScoreDTO;
  /** 다음 단계로 진행 핸들러 */
  onProceed: () => void;
}

/** 문장 유형 한국어 레이블 */
const SENTENCE_TYPE_LABELS: Record<string, string> = {
  'active-passive': '능동/수동',
  'relative-clause': '관계절',
  'embedded-clause': '내포절',
};

/** 정답률에 따른 색상 클래스 */
function getRateColorClass(rate: number | null): string {
  if (rate === null) return 'text-gray-400';
  if (rate >= 0.8) return 'text-green-600';
  if (rate >= 0.5) return 'text-yellow-600';
  return 'text-red-600';
}

export const ScoreResultPanel: React.FC<ScoreResultPanelProps> = ({
  score,
  onProceed,
}) => {
  const sentenceTypes = ['active-passive', 'relative-clause', 'embedded-clause'];

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* 완료 헤더 */}
      <div className="text-center">
        <p className="text-4xl mb-2" aria-hidden="true">
          ✅
        </p>
        <h2 className="text-2xl font-bold text-gray-800">검사 완료</h2>
      </div>

      {/* 총점 카드 */}
      <div
        className="bg-white rounded-2xl shadow-md p-6 text-center"
        aria-label={`총점: ${score.totalScore}점`}
      >
        <p className="text-sm text-gray-500 mb-2">총점</p>
        <p className="text-6xl font-bold text-blue-600">
          {score.totalScore}
          <span className="text-2xl text-gray-400 font-normal">점</span>
        </p>
        <p className="text-sm text-gray-400 mt-2">
          {score.correctCount} / {score.totalItems} 정답
        </p>
      </div>

      {/* 문장 유형별 정답률 테이블 */}
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h3 className="font-semibold text-gray-700 mb-4">유형별 정답률</h3>
        <table className="w-full" aria-label="문장 유형별 정답률 표">
          <thead>
            <tr className="text-left text-sm text-gray-500 border-b border-gray-100">
              <th className="pb-2 font-medium">유형</th>
              <th className="pb-2 font-medium text-right">정답 / 전체</th>
              <th className="pb-2 font-medium text-right">정답률</th>
            </tr>
          </thead>
          <tbody>
            {sentenceTypes.map((sentenceType) => {
              const stats = score.byType[sentenceType];
              const label = SENTENCE_TYPE_LABELS[sentenceType] ?? sentenceType;

              if (stats === undefined || stats.total === 0) {
                return (
                  <tr
                    key={sentenceType}
                    className="border-b border-gray-50 last:border-0"
                  >
                    <td className="py-3 text-gray-700">{label}</td>
                    <td className="py-3 text-right text-gray-400">-</td>
                    <td className="py-3 text-right text-gray-400">-</td>
                  </tr>
                );
              }

              const ratePercent =
                stats.rate !== null
                  ? `${Math.round(stats.rate * 100)}%`
                  : '-';
              const colorClass = getRateColorClass(stats.rate);

              return (
                <tr
                  key={sentenceType}
                  className="border-b border-gray-50 last:border-0"
                >
                  <td className="py-3 text-gray-700">{label}</td>
                  <td className="py-3 text-right text-gray-500">
                    {stats.correct} / {stats.total}
                  </td>
                  <td className={`py-3 text-right font-semibold ${colorClass}`}>
                    {ratePercent}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 추가 통계 */}
      <div className="bg-white rounded-2xl shadow-md p-6 flex flex-col gap-3">
        <h3 className="font-semibold text-gray-700 mb-1">세부 통계</h3>

        <div className="flex justify-between items-center py-2 border-b border-gray-50">
          <span className="text-gray-600 text-sm">평균 반응 시간</span>
          <span className="font-medium text-gray-800">
            {Math.round(score.averageReactionTimeMs)} ms
          </span>
        </div>

        <div className="flex justify-between items-center py-2">
          <span className="text-gray-600 text-sm">평균 재청취 횟수</span>
          <span className="font-medium text-gray-800">
            {score.averageReplayCount.toFixed(1)} 회
          </span>
        </div>
      </div>

      {/* 다음 단계 버튼 */}
      <button
        type="button"
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 rounded-2xl text-lg transition-colors active:scale-[0.98]"
        onClick={onProceed}
      >
        다음 검사로 이동
      </button>
    </div>
  );
};
