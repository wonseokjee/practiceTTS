/**
 * 검사 진행 상태 표시 바 (공유 컴포넌트)
 *
 * 현재 문항 번호와 전체 문항 수를 받아 진행률을 시각적으로 표시한다.
 * 다양한 검사(SentComp, LOC 등)에서 재사용 가능하다.
 */

import type React from 'react';

interface AssessmentProgressBarProps {
  /** 현재 진행 중인 문항 번호 (1-based) */
  current: number;
  /** 전체 문항 수 */
  total: number;
}

export const AssessmentProgressBar: React.FC<AssessmentProgressBarProps> = ({
  current,
  total,
}) => {
  const progressPercent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="w-full" aria-label={`진행 현황: ${current} / ${total} 문항`}>
      {/* 문항 수 텍스트 */}
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-[#6B6560] font-medium">
          {current} / {total} 문항
        </span>
        <span className="text-sm text-[#9AA09B]">{progressPercent}%</span>
      </div>

      {/* 진행 바 */}
      <div
        className="w-full h-2 bg-[#E8E4DC] rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          className="h-full bg-[#2D6A56] rounded-full transition-all duration-300 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
};
