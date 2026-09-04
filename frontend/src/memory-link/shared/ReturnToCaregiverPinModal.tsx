/**
 * 환자 모드 → 보호자 복귀 PIN 모달
 *
 * 보호자 단일 계정 모델: 환자에게 기기를 건넨 동안 환자가 보호자 사적 데이터에
 * 접근하지 못하도록, 보호자로 돌아올 때 4자리 PIN을 검증한다(백엔드 검증).
 *
 * 디자인(Warm Clinical):
 * - surface #FFFFFF, radius xl(24px) 단일 패널, 장식 그림자/블롭 없음
 * - 세이지 그린(`primary`) 포커스, 에러는 색·테두리로만(bounce/shake 금지)
 * 접근성: role="dialog" + aria-modal, 첫 입력 자동 포커스, Esc=취소,
 *         숫자 키패드(inputMode), 44px+ 터치 타깃, 에러 aria-live
 */

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

interface ReturnToCaregiverPinModalProps {
  isOpen: boolean;
  /** 취소 (환자 모드 유지) */
  onCancel: () => void;
  /** PIN 검증 — 성공 시 true */
  onVerify: (pin: string) => Promise<boolean>;
}

export function ReturnToCaregiverPinModal({
  isOpen,
  onCancel,
  onVerify,
}: ReturnToCaregiverPinModalProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 열릴 때 입력 초기화 + 첫 입력 포커스
  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(null);
      setIsSubmitting(false);
      // 렌더 후 포커스
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!/^[0-9]{4}$/.test(pin)) {
      setError('4자리 숫자를 입력해주세요.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const ok = await onVerify(pin);
      if (!ok) {
        setError('PIN이 일치하지 않아요. 다시 입력해주세요.');
        setPin('');
        inputRef.current?.focus();
      }
      // 성공 시: 상위에서 isPatientMode가 false가 되어 라우터가 /caregiver로 이동
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && !isSubmitting) {
      onCancel();
    }
  };

  return (
    <div
      className="font-pretendard fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-modal-title"
        className="w-full max-w-sm rounded-3xl bg-white p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="pin-modal-title"
          className="text-xl font-bold text-ink-sage"
        >
          기기를 돌려주셨네요
        </h2>
        <p className="mt-2 text-sm text-muted-sage">
          보호자 PIN을 입력해주세요.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5" noValidate>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            value={pin}
            disabled={isSubmitting}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
            }
            aria-label="보호자 PIN 4자리"
            className={`w-full min-h-[56px] rounded-xl border-2 px-4 text-center text-2xl tracking-[0.6em] tabular-nums focus:outline-none ${
              error
                ? 'border-accent bg-accent-soft'
                : 'border-line-soft focus:border-primary'
            }`}
            placeholder="••••"
          />

          {error !== null && (
            <p
              role="alert"
              aria-live="assertive"
              className="mt-3 text-sm text-accent-ink"
            >
              {error}
            </p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="min-h-[48px] flex-1 rounded-xl bg-canvas px-4 text-sm font-medium text-muted-sage transition-colors hover:bg-[#EFEEE9] disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[48px] flex-1 rounded-xl bg-primary px-4 text-sm font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:opacity-50"
            >
              {isSubmitting ? '확인 중...' : '확인'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
