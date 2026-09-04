/**
 * 로딩 오버레이 컴포넌트 (공유 컴포넌트)
 *
 * 데이터 로딩 중 또는 처리 중임을 나타내는 스피너와 메시지를 표시한다.
 * 다양한 검사 화면에서 재사용 가능하다.
 */

import type React from 'react';

interface LoadingOverlayProps {
  /** 로딩 중 표시할 텍스트. 기본값: '로딩 중...' */
  message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  message = '로딩 중...',
}) => {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16"
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      {/* 회전 스피너 */}
      <div
        className="w-12 h-12 border-4 border-line border-t-primary rounded-full animate-spin"
        aria-hidden="true"
      />

      {/* 로딩 텍스트 */}
      <p className="text-muted text-base">{message}</p>
    </div>
  );
};
