/**
 * 단어 이해 (WordComp) 검사 - 문항 진행 바
 *
 * 현재 문항 번호와 전체 문항 수를 표시한다.
 */

import type React from 'react';

interface ItemProgressBarProps {
  current: number;
  total: number;
}

export const ItemProgressBar: React.FC<ItemProgressBarProps> = ({
  current,
  total,
}) => {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-medium text-[#6B6560]">
          {current} / {total}
        </span>
        <span className="text-sm text-[#6B6560]">{percentage}%</span>
      </div>
      <div className="w-full bg-[#F2F1EC] rounded-full h-2">
        <div
          className="bg-[#2D6A56] h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${total}문항 중 ${current}번째`}
        />
      </div>
    </div>
  );
};
