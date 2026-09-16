/**
 * 채점 결과 패널 컴포넌트
 *
 * 총점, 문장 유형별 정답률 테이블,
 * 평균 반응시간, 평균 재청취 횟수를 표시한다.
 */

import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { ScoreDTO } from '../../application/dtos.js';

interface ScoreResultPanelProps {
  /** 채점 결과 DTO */
  score: ScoreDTO;
  /** 다음 단계로 진행 핸들러 */
  onProceed: () => void;
}

/** 문장 유형 → i18n 키 이름 */
const SENTENCE_TYPE_KEYS: Record<string, string> = {
  reversible: 'reversible',
  'relative-clause': 'relativeClause',
  'embedded-clause': 'embeddedClause',
};

/** 정답률에 따른 색상 클래스 */
function getRateColorClass(rate: number | null): string {
  if (rate === null) return 'text-muted-sage';
  if (rate >= 0.8) return 'text-primary';
  if (rate >= 0.5) return 'text-[#8a5a1a]';
  return 'text-danger';
}

export const ScoreResultPanel: React.FC<ScoreResultPanelProps> = ({
  score,
  onProceed,
}) => {
  const { t } = useTranslation('assessments');
  const sentenceTypes = ['reversible', 'relative-clause', 'embedded-clause'];

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* 완료 헤더 */}
      <div className="text-center">
        <p className="text-4xl mb-2" aria-hidden="true">
          ✅
        </p>
        <h2 className="text-2xl font-bold text-ink">
          {t('sentComp.scoreResultPanel.title')}
        </h2>
      </div>

      {/* 총점 카드 */}
      <div
        className="bg-white rounded-2xl shadow-md p-6 text-center"
        aria-label={t('sentComp.scoreResultPanel.totalScoreAria', {
          score: score.totalScore,
        })}
      >
        <p className="text-sm text-muted-sage mb-2">
          {t('sentComp.scoreResultPanel.totalScoreLabel')}
        </p>
        <p className="text-6xl font-bold text-primary">
          {score.totalScore}
          <span className="text-2xl text-muted-sage font-normal">
            {t('sentComp.scoreResultPanel.pointsUnit')}
          </span>
        </p>
        <p className="text-sm text-muted-sage mt-2">
          {t('sentComp.scoreResultPanel.correctCount', {
            correct: score.correctCount,
            total: score.totalItems,
          })}
        </p>
      </div>

      {/* 문장 유형별 정답률 테이블 */}
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h3 className="font-semibold text-ink mb-4">
          {t('sentComp.scoreResultPanel.byTypeTitle')}
        </h3>
        <table className="w-full" aria-label={t('sentComp.scoreResultPanel.tableAria')}>
          <thead>
            <tr className="text-left text-sm text-muted-sage border-b border-line">
              <th className="pb-2 font-medium">
                {t('sentComp.scoreResultPanel.typeHeader')}
              </th>
              <th className="pb-2 font-medium text-right">
                {t('sentComp.scoreResultPanel.correctOverTotalHeader')}
              </th>
              <th className="pb-2 font-medium text-right">
                {t('sentComp.scoreResultPanel.accuracyHeader')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sentenceTypes.map((sentenceType) => {
              const stats = score.byType[sentenceType];
              const typeKey = SENTENCE_TYPE_KEYS[sentenceType] ?? sentenceType;
              const label = t(`sentComp.scoreResultPanel.sentenceType.${typeKey}`, {
                defaultValue: sentenceType,
              });

              if (stats === undefined || stats.total === 0) {
                return (
                  <tr
                    key={sentenceType}
                    className="border-b border-line/60 last:border-0"
                  >
                    <td className="py-3 text-ink">{label}</td>
                    <td className="py-3 text-right text-muted-sage">-</td>
                    <td className="py-3 text-right text-muted-sage">-</td>
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
                  className="border-b border-line/60 last:border-0"
                >
                  <td className="py-3 text-ink">{label}</td>
                  <td className="py-3 text-right text-muted-sage">
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
        <h3 className="font-semibold text-ink mb-1">
          {t('sentComp.scoreResultPanel.detailStatsTitle')}
        </h3>

        <div className="flex justify-between items-center py-2 border-b border-line/60">
          <span className="text-muted-sage text-sm">
            {t('sentComp.scoreResultPanel.avgReactionTimeLabel')}
          </span>
          <span className="font-medium text-ink">
            {Math.round(score.averageReactionTimeMs)} ms
          </span>
        </div>

        <div className="flex justify-between items-center py-2">
          <span className="text-muted-sage text-sm">
            {t('sentComp.scoreResultPanel.avgReplayCountLabel')}
          </span>
          <span className="font-medium text-ink">
            {score.averageReplayCount.toFixed(1)}{' '}
            {t('sentComp.scoreResultPanel.replayUnit')}
          </span>
        </div>
      </div>

      {/* 다음 단계 버튼 */}
      <button
        type="button"
        className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-4 rounded-2xl text-lg transition-colors active:scale-[0.98]"
        onClick={onProceed}
      >
        {t('sentComp.scoreResultPanel.nextAssessmentButton')}
      </button>
    </div>
  );
};
