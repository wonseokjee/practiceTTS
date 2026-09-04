/**
 * 검사 허브 - 개별 검사 카드 컴포넌트
 *
 * isCompleted=false: 파란 테두리 + "시작하기" 버튼
 * isCompleted=true: 초록 테두리 + "완료" 뱃지 + 비활성 버튼
 */

import type React from 'react';

interface AssessmentCardProps {
  title: string;
  subtitle: string;
  description: string;
  isCompleted: boolean;
  onStart: () => void;
}

export function AssessmentCard({
  title,
  subtitle,
  description,
  isCompleted,
  onStart,
}: AssessmentCardProps): React.JSX.Element {
  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border p-6 ${
        isCompleted ? 'border-primary/25 bg-primary-light' : 'border-[#c8e6d9]'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            {isCompleted && (
              <span className="text-xs font-medium text-primary bg-primary-light px-2 py-0.5 rounded-full">
                완료
              </span>
            )}
          </div>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </div>
      <p className="text-sm text-muted mb-4">{description}</p>
      <button
        type="button"
        className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
          isCompleted
            ? 'bg-line text-muted cursor-default'
            : 'bg-primary hover:bg-primary-dark text-white'
        }`}
        onClick={isCompleted ? undefined : onStart}
      >
        {isCompleted ? '완료' : '시작하기'}
      </button>
    </div>
  );
}
