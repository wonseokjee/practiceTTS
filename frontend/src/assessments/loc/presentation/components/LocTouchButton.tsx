/**
 * LOC 검사 터치 버튼 컴포넌트
 *
 * - 70vh 높이의 대형 터치 영역 제공 (실어증 환자 접근성 고려)
 * - isSelectable=false일 때 시각적으로 비활성화 상태 표시
 * - 비즈니스 로직 없음 (모든 처리는 콜백에 위임)
 *
 * 포인터 입력은 여기서 받지 않는다. 리스너가 버튼에 달려 있으면 버튼 밖을
 * 짚은 반응이 잡히지 않아 '무반응'으로 잘못 기록되므로, pointerdown은 상위
 * 검사 영역이 받는다(useLocViewModel.handleAreaPointerDown).
 *
 * 이 버튼이 직접 받는 것은 **키보드·보조기기 활성화**뿐이다. 예전에는
 * onPointerDown만 있어서 Enter/Space가 아무 일도 하지 않았고, 키보드
 * 사용자는 10초 뒤 무반응 0점(='각성 저하' 소견)을 받았다.
 */

import type React from 'react';
import { useTranslation } from 'react-i18next';

interface LocTouchButtonProps {
  isSelectable: boolean;
  /** 키보드·보조기기로 버튼을 활성화했을 때 */
  onActivate: () => void;
  /** 영역 판정의 기준 사각형을 재기 위해 상위에서 연결한다 */
  buttonRef?: React.Ref<HTMLButtonElement>;
}

export function LocTouchButton({
  isSelectable,
  onActivate,
  buttonRef,
}: LocTouchButtonProps) {
  const { t } = useTranslation('assessments');
  return (
    <button
      ref={buttonRef}
      type="button"
      className={[
        'w-full flex-1 min-h-[160px] rounded-3xl',
        'flex flex-col items-center justify-center gap-4',
        'select-none touch-none',
        'transition-all duration-300',
        isSelectable
          ? [
              'bg-primary-light hover:bg-[#d5e9e1] active:bg-[#c4ddd3]',
              'border-4 border-primary',
              'text-primary',
              'cursor-pointer',
            ].join(' ')
          : [
              'bg-line text-muted-disabled',
              'cursor-not-allowed',
            ].join(' '),
      ].join(' ')}
      disabled={!isSelectable}
      // 키보드 Enter/Space는 click만 합성한다(pointerdown 없음). 마우스
      // 클릭으로도 여기가 불리지만, 그때는 이미 영역 핸들러가 처리한 뒤라
      // 뷰모델의 중복 가드가 두 번째를 걸러낸다.
      onClick={isSelectable ? onActivate : undefined}
      aria-label={
        isSelectable ? t('loc.touchButton.touchAria') : t('loc.touchButton.waitAria')
      }
      aria-disabled={!isSelectable}
    >
      {/* 아이콘 영역 — 버튼에 aria-label이 있으므로 아이콘은 장식으로 숨긴다 */}
      {isSelectable ? <TapIcon /> : <MutedIcon />}

      {/* 안내 텍스트 */}
      <p className="text-2xl font-bold">
        {isSelectable ? t('loc.touchButton.touchLabel') : t('loc.touchButton.waitingLabel')}
      </p>

      {isSelectable && (
        <p className="text-base opacity-75">{t('loc.touchButton.instructionHint')}</p>
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
