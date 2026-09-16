/**
 * 이미지 선택지 그리드 컴포넌트
 *
 * 2개의 이미지 선택지를 세로로 배치한다.
 * PLAYING 상태에서는 isSelectable=false로 선택을 비활성화한다.
 */

import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { ChoiceImage } from '../../domain/types.js';
import { ChoiceImageCard } from './ChoiceImageCard.js';

interface ImageChoiceGridProps {
  /** 선택지 이미지 배열 (항상 2개) */
  choices: readonly [ChoiceImage, ChoiceImage];
  /** 선택 가능한 상태인지 여부 */
  isSelectable: boolean;
  /** 현재 선택된 인덱스 (미선택 시 null) */
  selectedIndex: 0 | 1 | null;
  /** 선택지 선택 핸들러 */
  onSelect: (index: 0 | 1) => void;
}

export const ImageChoiceGrid: React.FC<ImageChoiceGridProps> = ({
  choices,
  isSelectable,
  selectedIndex,
  onSelect,
}) => {
  const { t } = useTranslation('assessments');
  return (
    <div
      className="flex flex-row gap-4 w-full"
      aria-label={t('sentComp.imageChoiceGrid.groupAria')}
      role="group"
    >
      {choices.map((choice, i) => {
        const index = i as 0 | 1;
        return (
          <ChoiceImageCard
            key={choice.imageUrl}
            choice={choice}
            index={index}
            isSelected={selectedIndex === index}
            isSelectable={isSelectable}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
};
