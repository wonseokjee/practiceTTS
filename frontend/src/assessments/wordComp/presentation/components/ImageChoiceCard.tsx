/**
 * 단어 이해 (WordComp) 검사 - 이미지 선택지 카드 컴포넌트
 *
 * 이미지 하나를 카드 형태로 표시하고, 선택 가능한 상태에서만 포인터 다운을 처리한다.
 * click 대신 onPointerDown 사용으로 반응 시간 ~100~300ms 단축.
 * touch-action: none 으로 스크롤 이벤트 충돌 방지.
 */

import type React from 'react';
import type { WordComprehensionChoiceDTO } from '../../application/dtos/WordComprehensionChoiceDTO.js';

interface ImageChoiceCardProps {
  choice: WordComprehensionChoiceDTO;
  isSelectable: boolean;
  onSelect: (choiceId: string) => void;
}

export const ImageChoiceCard: React.FC<ImageChoiceCardProps> = ({
  choice,
  isSelectable,
  onSelect,
}) => {
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isSelectable) return;
    e.preventDefault(); // 스크롤 이벤트 충돌 방지
    onSelect(choice.choiceId);
  };

  return (
    <button
      type="button"
      className={`
        relative w-full aspect-square rounded-2xl overflow-hidden border-4 transition-all duration-150
        ${isSelectable
          ? 'border-gray-200 hover:border-blue-300 active:scale-[0.97] cursor-pointer'
          : 'border-gray-100 cursor-not-allowed opacity-60'
        }
      `}
      onPointerDown={handlePointerDown}
      disabled={!isSelectable}
      style={{ touchAction: 'none' }}
      aria-label={`${choice.word} 선택`}
    >
      <img
        src={choice.imageUrl}
        alt={choice.word}
        className="w-full h-full object-cover"
        loading="eager"
        onError={(e) => {
          const target = e.currentTarget;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent !== null) {
            parent.style.backgroundColor = '#f3f4f6';
          }
        }}
      />

      {/* 이미지 로드 실패 폴백 */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 text-gray-500 text-sm font-medium"
        aria-hidden="true"
      >
        <span className="text-2xl mb-1">🖼️</span>
        <span>{choice.word}</span>
      </div>

      {/* 단어 라벨 (이미지 하단) */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-2">
        <p className="text-white text-sm font-medium text-center truncate">
          {choice.word}
        </p>
      </div>
    </button>
  );
};
