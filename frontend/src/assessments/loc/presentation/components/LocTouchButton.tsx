/**
 * LOC 검사 터치 버튼 컴포넌트
 *
 * - 70vh 높이의 대형 터치 영역 제공 (실어증 환자 접근성 고려)
 * - onPointerDown 이벤트로 최초 접촉 시점을 정밀하게 측정
 * - isSelectable=false일 때 시각적으로 비활성화 상태 표시
 * - 비즈니스 로직 없음 (모든 처리는 onTouch 콜백에 위임)
 */

import type React from 'react';

interface LocTouchButtonProps {
  isSelectable: boolean;
  onTouch: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

export function LocTouchButton({ isSelectable, onTouch }: LocTouchButtonProps) {
  return (
    <button
      type="button"
      className={[
        'w-full flex-1 min-h-[160px] rounded-3xl',
        'flex flex-col items-center justify-center gap-4',
        'select-none touch-none',
        'transition-all duration-300',
        isSelectable
          ? [
              'bg-[#EBF4F0] hover:bg-[#d5e9e1] active:bg-[#c4ddd3]',
              'border-4 border-[#2D6A56]',
              'text-[#2D6A56]',
              'cursor-pointer',
            ].join(' ')
          : [
              'bg-[#E8E4DC] text-[#9AA09B]',
              'cursor-not-allowed',
            ].join(' '),
      ].join(' ')}
      disabled={!isSelectable}
      onPointerDown={isSelectable ? onTouch : undefined}
      aria-label={isSelectable ? '여기를 터치하세요' : '음성 안내를 기다리세요'}
      aria-disabled={!isSelectable}
    >
      {/* 아이콘 영역 — 버튼에 aria-label이 있으므로 아이콘은 장식으로 숨긴다 */}
      {isSelectable ? <TapIcon /> : <MutedIcon />}

      {/* 안내 텍스트 */}
      <p className="text-2xl font-bold">
        {isSelectable ? '여기를 터치하세요' : '잠시 기다려 주세요'}
      </p>

      {isSelectable && (
        <p className="text-base opacity-75">
          음성 지시를 들은 후 터치하세요
        </p>
      )}
    </button>
  );
}

// ─── 아이콘 ─────────────────────────────────────────────────────
//
// 이모지는 플랫폼(iOS/Android/Windows)마다 모양이 달라 임상 도구에서 신뢰도를
// 떨어뜨리고 크기·색을 제어할 수 없다. currentColor를 쓰는 인라인 SVG로 두어
// 버튼의 활성/비활성 색상(text-*)을 그대로 따르게 한다.

/** 터치 지점 표시 — 가운데 점 + 퍼지는 두 겹의 원. */
function TapIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-16 w-16"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="8" fill="currentColor" stroke="none" />
      <circle cx="32" cy="32" r="18" opacity="0.55" />
      <circle cx="32" cy="32" r="28" opacity="0.25" />
    </svg>
  );
}

/** 음성 안내 대기 — 소리 없음(스피커에 사선). */
function MutedIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-16 w-16"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 24h10l14-11v38L22 40H12z"
        fill="currentColor"
        stroke="currentColor"
      />
      <path d="M46 24l12 16" />
      <path d="M58 24L46 40" />
    </svg>
  );
}
