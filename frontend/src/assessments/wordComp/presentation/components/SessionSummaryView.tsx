/**
 * 단어 이해 (WordComp) 검사 - 세션 요약 결과 화면
 *
 * 총점, 백분율, 오답 패턴(의미/음운/무관), 평균 반응 시간을 표시한다.
 */

import type React from 'react';
import type { SessionSummaryDTO } from '../../application/dtos/SessionSummaryDTO.js';

interface SessionSummaryViewProps {
  summary: SessionSummaryDTO;
  onProceed?: () => void;
}

export const SessionSummaryView: React.FC<SessionSummaryViewProps> = ({
  summary,
  onProceed,
}) => {
  const { totalScore, percentageScore, totalItems, distractorPattern, averageReactionTimeMs, averageReplayCount } = summary;
  const totalErrors = totalItems - totalScore;

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* 총점 카드 */}
      <div className="bg-white rounded-2xl shadow-sm border border-line p-6 text-center">
        <p className="text-sm text-muted mb-1">단어 이해 검사 결과</p>
        <p className="text-5xl font-bold text-primary mb-1">{totalScore}</p>
        <p className="text-muted text-sm">/ {totalItems}점</p>
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
          <h3 className="text-sm font-semibold text-muted mb-4">
            오답 패턴 분석 (총 {totalErrors}개 오답)
          </h3>
          <div className="flex flex-col gap-3">
            <DistractorBar
              label="의미 착어"
              description="의미적으로 유사한 단어 선택"
              count={distractorPattern.semanticErrorCount}
              rate={distractorPattern.semanticErrorRate}
              color="blue"
            />
            <DistractorBar
              label="음운 착어"
              description="발음이 유사한 단어 선택"
              count={distractorPattern.phonemicErrorCount}
              rate={distractorPattern.phonemicErrorRate}
              color="orange"
            />
            <DistractorBar
              label="무관 오답"
              description="전혀 무관한 단어 선택"
              count={distractorPattern.unrelatedErrorCount}
              rate={distractorPattern.unrelatedErrorRate}
              color="red"
            />
          </div>
        </div>
      )}

      {/* 반응 시간 / 재청취 통계 */}
      <div className="bg-white rounded-2xl shadow-sm border border-line p-6">
        <h3 className="text-sm font-semibold text-muted mb-4">반응 통계</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-ink">
              {(averageReactionTimeMs / 1000).toFixed(1)}초
            </p>
            <p className="text-xs text-muted mt-1">평균 반응 시간</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-ink">
              {averageReplayCount.toFixed(1)}회
            </p>
            <p className="text-xs text-muted mt-1">평균 재청취 횟수</p>
          </div>
        </div>
      </div>

      {onProceed !== undefined && (
        <button
          type="button"
          className="w-full py-4 bg-primary hover:bg-primary-dark text-white font-semibold rounded-2xl transition-colors text-base"
          onClick={onProceed}
        >
          다음 검사로 이동
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
  const colors = colorMap[color];
  const pct = Math.round(rate * 100);

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <div>
          <span className="text-sm font-medium text-ink">{label}</span>
          <span className="text-xs text-muted ml-1.5">{description}</span>
        </div>
        <span className={`text-sm font-semibold ${colors.text}`}>
          {count}회 ({pct}%)
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
