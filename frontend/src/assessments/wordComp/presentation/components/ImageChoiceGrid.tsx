/**
 * 단어 이해 (WordComp) 검사 - 2x2 이미지 선택지 그리드
 *
 * 4개의 ImageChoiceCard를 2x2 그리드로 배치한다.
 */

import type React from 'react';
import type { WordComprehensionChoiceDTO } from '../../application/dtos/WordComprehensionChoiceDTO.js';
import { ImageChoiceCard } from './ImageChoiceCard.js';

interface ImageChoiceGridProps {
  choices: ReadonlyArray<WordComprehensionChoiceDTO>;
  isSelectable: boolean;
  onSelect: (choiceId: string) => void;
}

export const ImageChoiceGrid: React.FC<ImageChoiceGridProps> = ({
  choices,
  isSelectable,
  onSelect,
}) => {
  return (
    <div
      className="grid grid-cols-2 gap-3"
      role="group"
      aria-label="선택지 이미지"
    >
      {choices.map((choice) => (
        <ImageChoiceCard
          key={choice.choiceId}
          choice={choice}
          isSelectable={isSelectable}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};
