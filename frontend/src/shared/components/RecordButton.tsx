/**
 * 공통 녹음 버튼 컴포넌트.
 *
 * 내부에서 useWhisperSTT를 사용하여 상태를 관리하며, 변환이 완료되면 onTranscribed
 * 콜백을 호출한다. 상위 컴포넌트는 녹음 세부 로직을 모른 채 텍스트만 받는다.
 *
 * UI 상태:
 * - idle         : 마이크 아이콘 + "녹음" (세이지 그린 테두리)
 * - recording    : 빨간 점 펄스 + "녹음 중..." + 경과 시간(초)
 * - transcribing : 로딩 스피너 + "변환 중..."
 * - error        : 에러 메시지 + 재시도 버튼
 *
 * 디자인 시스템 (Warm Clinical):
 * - 세이지 그린 #2D6A56 (idle 테두리/텍스트)
 * - 테라코타/레드 계열로 녹음 중 강조
 * - rounded-xl, 180ms ease 전환
 */

import { useEffect, useRef, useState } from 'react';
import { useWhisperSTT } from '../hooks/useWhisperSTT.js';

export interface RecordButtonProps {
  /** 변환 완료 시 호출되는 콜백. */
  onTranscribed: (text: string) => void;
  /** true면 버튼을 비활성화한다. */
  disabled?: boolean;
  /** 최대 녹음 시간(ms). 기본값은 useWhisperSTT 기본값에 위임. */
  maxDurationMs?: number;
  /** 외부 컨테이너 추가 클래스. */
  className?: string;
  /** 크기 변형. */
  size?: 'sm' | 'md' | 'lg';
  /** 변환 결과 텍스트를 버튼 하단에 표시할지 여부. */
  showTranscript?: boolean;
}

/** size별 패딩/텍스트 크기 매핑 (Tailwind 클래스). */
const SIZE_CLASSES: Record<NonNullable<RecordButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-base gap-2',
  lg: 'px-6 py-3 text-lg gap-3',
};

/** 상태별 텍스트 색상 유틸리티. */
const TRANSITION_CLASS =
  'transition-colors duration-[180ms] ease-in-out';

export function RecordButton({
  onTranscribed,
  disabled = false,
  maxDurationMs,
  className = '',
  size = 'md',
  showTranscript = false,
}: RecordButtonProps): React.ReactElement {
  const {
    isRecording,
    isTranscribing,
    transcript,
    error,
    startRecording,
    stopAndTranscribe,
    reset,
  } = useWhisperSTT({
    maxDurationMs,
    onTranscribed,
  });

  // 경과 시간 표시 (녹음 중일 때 1초 간격으로 갱신)
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recordingStartRef = useRef<number>(0);

  useEffect(() => {
    if (!isRecording) {
      setElapsedSeconds(0);
      return;
    }
    recordingStartRef.current = Date.now();
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  const handleClick = async (): Promise<void> => {
    if (disabled || isTranscribing) return;
    if (isRecording) {
      await stopAndTranscribe();
    } else {
      await startRecording();
    }
  };

  const handleRetry = (): void => {
    reset();
  };

  // 에러 상태 렌더링 (버튼 대신 에러 메시지 + 재시도)
  if (error) {
    return (
      <div
        className={`flex flex-col items-start gap-2 ${className}`}
        role="alert"
        aria-live="assertive"
      >
        <p className="text-sm text-[#E07B54]">{error}</p>
        <button
          type="button"
          onClick={handleRetry}
          className={`inline-flex items-center rounded-xl border border-[#2D6A56] text-[#2D6A56] hover:bg-[#EBF4F0] ${TRANSITION_CLASS} ${SIZE_CLASSES[size]}`}
        >
          다시 시도
        </button>
      </div>
    );
  }

  // 상태별 버튼 본문
  let buttonLabel: string;
  let buttonClass: string;
  let iconNode: React.ReactElement;

  if (isTranscribing) {
    buttonLabel = '변환 중...';
    buttonClass = 'border border-[#2D6A56] text-[#2D6A56] cursor-wait';
    iconNode = <SpinnerIcon size={size} />;
  } else if (isRecording) {
    buttonLabel = `녹음 중... ${elapsedSeconds}초`;
    buttonClass = 'bg-[#E07B54] text-white border border-[#E07B54] hover:bg-[#C96B48]';
    iconNode = <PulseDot />;
  } else {
    buttonLabel = '녹음';
    buttonClass = 'border border-[#2D6A56] text-[#2D6A56] hover:bg-[#EBF4F0]';
    iconNode = <MicIcon size={size} />;
  }

  const isButtonDisabled = disabled || isTranscribing;

  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isButtonDisabled}
        aria-pressed={isRecording}
        aria-busy={isTranscribing}
        aria-label={buttonLabel}
        className={`inline-flex items-center rounded-xl font-medium ${TRANSITION_CLASS} ${SIZE_CLASSES[size]} ${buttonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {iconNode}
        <span>{buttonLabel}</span>
      </button>
      {showTranscript && transcript && (
        <p
          className="text-sm text-[#2D6A56] max-w-full break-words"
          aria-live="polite"
        >
          {transcript}
        </p>
      )}
    </div>
  );
}

// ─── 인라인 아이콘 (외부 라이브러리 없음) ───────────────────────────

function iconPixelSize(size: NonNullable<RecordButtonProps['size']>): number {
  if (size === 'sm') return 14;
  if (size === 'lg') return 22;
  return 18;
}

function MicIcon({
  size,
}: {
  size: NonNullable<RecordButtonProps['size']>;
}): React.ReactElement {
  const px = iconPixelSize(size);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function SpinnerIcon({
  size,
}: {
  size: NonNullable<RecordButtonProps['size']>;
}): React.ReactElement {
  const px = iconPixelSize(size);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function PulseDot(): React.ReactElement {
  // 녹음 중 시각적 피드백: 빨간 점 펄스
  return (
    <span
      className="relative inline-flex h-3 w-3"
      aria-hidden="true"
      data-testid="record-pulse-dot"
    >
      <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
    </span>
  );
}
