/**
 * 이미지 선택지 카드 컴포넌트
 *
 * 이미지 하나를 카드 형태로 표시하고, 선택 가능한 상태에서만 클릭을 처리한다.
 * 선택된 카드는 파란 테두리로 강조 표시된다.
 * 이미지 파일이 없을 경우 altText를 표시하는 폴백을 제공한다.
 */

import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { ChoiceImage } from '../../domain/types.js';

interface ChoiceImageCardProps {
  /** 선택지 이미지 데이터 */
  choice: ChoiceImage;
  /** 이미지 인덱스 (0 또는 1) */
  index: 0 | 1;
  /** 현재 선택된 카드인지 여부 */
  isSelected: boolean;
  /** 선택 가능한 상태인지 여부 (PLAYING 상태에서는 false) */
  isSelectable: boolean;
  /** 카드 선택 핸들러 */
  onSelect: (index: 0 | 1) => void;
}

export const ChoiceImageCard: React.FC<ChoiceImageCardProps> = ({
  choice,
  index,
  isSelected,
  isSelectable,
  onSelect,
}) => {
  const { t } = useTranslation('assessments');
  const handleClick = () => {
    if (!isSelectable) return;
    onSelect(index);
  };

  return (
    <button
      type="button"
      className={`
        relative w-full aspect-square rounded-2xl overflow-hidden border-4 transition-all duration-200
        ${isSelected ? 'border-primary shadow-lg scale-[1.02]' : 'border-line'}
        ${isSelectable ? 'cursor-pointer hover:border-primary active:scale-[0.98]' : 'cursor-not-allowed opacity-70'}
      `}
      onClick={handleClick}
      disabled={!isSelectable}
      aria-label={t('sentComp.choiceImageCard.selectAria', {
        index: index + 1,
        altText: choice.altText,
      })}
      aria-pressed={isSelected}
    >
      {/* 이미지 */}
      <img
        src={choice.imageUrl}
        alt={choice.altText}
        className="w-full h-full object-cover"
        onError={(e) => {
          // 이미지 로드 실패 시 폴백 배경 표시
          const target = e.currentTarget;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent !== null) {
            parent.style.background = '#f3f4f6';
          }
        }}
      />

      {/* 이미지 로드 실패 폴백: alt 텍스트 표시 */}
      <div
        className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-sage bg-surface-dim"
        aria-hidden="true"
        style={{ display: 'none' }}
      >
        {choice.altText}
      </div>

      {/* 선택됨 표시 오버레이 */}
      {isSelected && (
        <div
          className="absolute inset-0 bg-primary bg-opacity-10 flex items-center justify-center"
          aria-hidden="true"
        >
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      )}
    </button>
  );
};
