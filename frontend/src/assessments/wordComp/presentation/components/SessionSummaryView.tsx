/**
 * 단어 이해 (WordComp) 검사 - 세션 요약 결과 화면
 *
 * 총점, 백분율, 오답 패턴(의미/음운/무관), 평균 반응 시간을 표시한다.
 */

import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionSummaryDTO } from '../../application/dtos/SessionSummaryDTO.js';

interface SessionSummaryViewProps {
  summary: SessionSummaryDTO;
  onProceed?: () => void;
}

export const SessionSummaryView: React.FC<SessionSummaryViewProps> = ({
  summary,
  onProceed,
}) => {
  const { t } = useTranslation('assessments');
  const { totalScore, percentageScore, totalItems, distractorPattern, averageReactionTimeMs, averageReplayCount } = summary;
  const totalErrors = totalItems - totalScore;

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* 총점 카드 */}
      <div className="bg-white rounded-2xl shadow-sm border border-line p-6 text-center">
        <p className="text-sm text-muted-sage mb-1">
          {t('wordComp.sessionSummaryView.resultTitle')}
        </p>
        <p className="text-5xl font-bold text-primary mb-1">{totalScore}</p>
        <p className="text-muted-sage text-sm">
          {t('wordComp.sessionSummaryView.totalItemsSuffix', { total: totalItems })}
        </p>
        <div className="mt-3">
          <span
            className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold ${
              percentageScore >= 80
                ? 'bg-primary-light text-primary'
                : percentageScore >= 60
                ? 'bg-warning/15 text-[#8a5a1a]'
                : 'bg-danger/10 text-danger'
            }`}
          >
            {percentageScore}%
          </span>
        </div>
      </div>

      {/* 오답 패턴 분석 */}
      {totalErrors > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-line p-6">
          <h3 className="text-sm font-semibold text-muted-sage mb-4">
            {t('wordComp.sessionSummaryView.errorPatternTitle', { count: totalErrors })}
          </h3>
          <div className="flex flex-col gap-3">
            <DistractorBar
              label={t('wordComp.sessionSummaryView.semanticErrorLabel')}
              description={t('wordComp.sessionSummaryView.semanticErrorDescription')}
              count={distractorPattern.semanticErrorCount}
              rate={distractorPattern.semanticErrorRate}
              color="blue"
            />
            <DistractorBar
              label={t('wordComp.sessionSummaryView.phonemicErrorLabel')}
              description={t('wordComp.sessionSummaryView.phonemicErrorDescription')}
              count={distractorPattern.phonemicErrorCount}
              rate={distractorPattern.phonemicErrorRate}
              color="orange"
            />
            <DistractorBar
              label={t('wordComp.sessionSummaryView.unrelatedErrorLabel')}
              description={t('wordComp.sessionSummaryView.unrelatedErrorDescription')}
              count={distractorPattern.unrelatedErrorCount}
              rate={distractorPattern.unrelatedErrorRate}
              color="red"
            />
          </div>
        </div>
      )}

      {/* 반응 시간 / 재청취 통계 */}
      <div className="bg-white rounded-2xl shadow-sm border border-line p-6">
        <h3 className="text-sm font-semibold text-muted-sage mb-4">
          {t('wordComp.sessionSummaryView.reactionStatsTitle')}
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-ink">
              {t('wordComp.sessionSummaryView.avgReactionTimeValue', {
                seconds: (averageReactionTimeMs / 1000).toFixed(1),
              })}
            </p>
            <p className="text-xs text-muted-sage mt-1">
              {t('wordComp.sessionSummaryView.avgReactionTimeLabel')}
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-ink">
              {t('wordComp.sessionSummaryView.avgReplayCountValue', {
                count: averageReplayCount.toFixed(1),
              })}
            </p>
            <p className="text-xs text-muted-sage mt-1">
              {t('wordComp.sessionSummaryView.avgReplayCountLabel')}
            </p>
          </div>
        </div>
      </div>

      {onProceed !== undefined && (
        <button
          type="button"
          className="w-full py-4 bg-primary hover:bg-primary-dark text-white font-semibold rounded-2xl transition-colors text-base"
          onClick={onProceed}
        >
          {t('wordComp.sessionSummaryView.nextAssessmentButton')}
        </button>
      )}
    </div>
  );
};

interface DistractorBarProps {
  label: string;
  description: string;
  count: number;
  rate: number;
  color: 'blue' | 'orange' | 'red';
}

const colorMap = {
  blue: { bg: 'bg-primary', text: 'text-primary', light: 'bg-primary-light' },
  orange: { bg: 'bg-accent', text: 'text-[#b5602f]', light: 'bg-accent/15' },
  red: { bg: 'bg-danger', text: 'text-danger', light: 'bg-danger/10' },
};

const DistractorBar: React.FC<DistractorBarProps> = ({
  label,
  description,
  count,
  rate,
  color,
}) => {
  const { t } = useTranslation('assessments');
  const colors = colorMap[color];
  const pct = Math.round(rate * 100);

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <div>
          <span className="text-sm font-medium text-ink">{label}</span>
          <span className="text-xs text-muted-sage ml-1.5">{description}</span>
        </div>
        <span className={`text-sm font-semibold ${colors.text}`}>
          {t('wordComp.sessionSummaryView.countRate', { count, pct })}
        </span>
      </div>
      <div className={`w-full ${colors.light} rounded-full h-2`}>
        <div
          className={`${colors.bg} h-2 rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
