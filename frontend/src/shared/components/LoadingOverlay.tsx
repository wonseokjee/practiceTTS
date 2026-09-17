/**
 * 로딩 오버레이 컴포넌트 (공유 컴포넌트)
 *
 * 데이터 로딩 중 또는 처리 중임을 나타내는 스피너와 메시지를 표시한다.
 * 다양한 검사 화면에서 재사용 가능하다.
 */

import type React from 'react';
import { useTranslation } from 'react-i18next';

interface LoadingOverlayProps {
  /** 로딩 중 표시할 텍스트. 기본값: common:app.loading */
  message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message }) => {
  const { t } = useTranslation('common');
  const resolvedMessage = message ?? t('app.loading');
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16"
      role="status"
      aria-live="polite"
      aria-label={resolvedMessage}
    >
      {/* 회전 스피너 */}
      <div
        className="w-12 h-12 border-4 border-line border-t-primary rounded-full animate-spin"
        aria-hidden="true"
      />

      {/* 로딩 텍스트 */}
      <p className="text-muted-sage text-base">{resolvedMessage}</p>
    </div>
  );
};
