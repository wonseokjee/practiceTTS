// ReturnToCaregiverPinModal — 환자 모드 복귀 PIN 모달 테스트

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReturnToCaregiverPinModal } from './ReturnToCaregiverPinModal.js';

describe('ReturnToCaregiverPinModal', () => {
  it('isOpen=false면 렌더되지 않는다', () => {
    render(
      <ReturnToCaregiverPinModal
        isOpen={false}
        onCancel={vi.fn()}
        onVerify={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('올바른 4자리 입력 + 확인 → onVerify 호출', async () => {
    const onVerify = vi.fn().mockResolvedValue(true);
    render(
      <ReturnToCaregiverPinModal
        isOpen
        onCancel={vi.fn()}
        onVerify={onVerify}
      />,
    );
    fireEvent.change(screen.getByLabelText('보호자 PIN 4자리'), {
      target: { value: '1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    await waitFor(() => expect(onVerify).toHaveBeenCalledWith('1234'));
  });

  it('틀린 PIN(onVerify=false) → 에러 메시지 표시 + 모드 유지', async () => {
    const onVerify = vi.fn().mockResolvedValue(false);
    render(
      <ReturnToCaregiverPinModal
        isOpen
        onCancel={vi.fn()}
        onVerify={onVerify}
      />,
    );
    fireEvent.change(screen.getByLabelText('보호자 PIN 4자리'), {
      target: { value: '0000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('일치하지 않아요'),
    );
  });

  it('숫자가 아닌 입력은 걸러진다(4자리 숫자만)', () => {
    render(
      <ReturnToCaregiverPinModal isOpen onCancel={vi.fn()} onVerify={vi.fn()} />,
    );
    const input = screen.getByLabelText('보호자 PIN 4자리') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12ab' } });
    expect(input.value).toBe('12');
  });

  it('취소 버튼 → onCancel 호출', () => {
    const onCancel = vi.fn();
    render(
      <ReturnToCaregiverPinModal
        isOpen
        onCancel={onCancel}
        onVerify={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
