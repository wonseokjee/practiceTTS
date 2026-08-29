// FillBlankInput.tsx — 빈칸 채우기 입력 테스트
//
// 검증 포인트:
//  - 입력 후 제출 버튼 클릭 → onSubmit(트림된 텍스트)
//  - hintFirstChar 표시
//  - inputMode="text"
//  - 한글 IME 가드: composition 중(isComposing) Enter는 제출 안 됨,
//    composition 종료 후 Enter는 제출됨
//  - 빈 입력 시 제출 차단
//  - 피드백 단계: 정답/오답 색상 + 정답 노출

import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FillBlankInput } from './FillBlankInput.js';

interface Overrides {
  isSelectable?: boolean;
  showFeedback?: boolean;
  isCorrect?: boolean | null;
  correctAnswer?: string | null;
  hintFirstChar?: string | null;
}

function renderInput(overrides?: Overrides) {
  const onSubmit = vi.fn();
  render(
    <FillBlankInput
      isSelectable={overrides?.isSelectable ?? true}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrect={overrides?.isCorrect ?? null}
      correctAnswer={overrides?.correctAnswer ?? null}
      hintFirstChar={overrides?.hintFirstChar ?? null}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe('FillBlankInput', () => {
  it('입력 후 제출 버튼 클릭 시 onSubmit이 입력 텍스트로 호출된다', () => {
    const { onSubmit } = renderInput();
    const input = screen.getByRole('textbox', { name: '답 입력' });
    fireEvent.change(input, { target: { value: '공원' } });
    fireEvent.click(screen.getByRole('button', { name: '답 제출' }));
    expect(onSubmit).toHaveBeenCalledWith('공원');
  });

  it('앞뒤 공백은 트림되어 제출된다', () => {
    const { onSubmit } = renderInput();
    const input = screen.getByRole('textbox', { name: '답 입력' });
    fireEvent.change(input, { target: { value: '  공원  ' } });
    fireEvent.click(screen.getByRole('button', { name: '답 제출' }));
    expect(onSubmit).toHaveBeenCalledWith('공원');
  });

  it('빈 입력이면 제출 버튼이 비활성화된다', () => {
    renderInput();
    expect(screen.getByRole('button', { name: '답 제출' })).toBeDisabled();
  });

  it('inputMode="text"로 한글 입력에 친화적이다', () => {
    renderInput();
    expect(screen.getByRole('textbox', { name: '답 입력' })).toHaveAttribute(
      'inputMode',
      'text',
    );
  });

  it('hintFirstChar가 있으면 첫 글자 힌트를 표시한다', () => {
    renderInput({ hintFirstChar: '공' });
    expect(screen.getByText('공')).toBeInTheDocument();
  });

  // Found by browser QA on 2026-08-21 (연습 모드에서 같은 버그를 먼저 발견).
  // 조사를 '이에요'로 고정해두면 받침 없는 글자에서 "사 이에요"가 된다.
  it('힌트 글자의 받침에 따라 조사가 달라진다', () => {
    renderInput({ hintFirstChar: '공' });
    expect(screen.getByText(/첫 글자는/)).toHaveTextContent('공이에요');

    cleanup();
    renderInput({ hintFirstChar: '사' });
    expect(screen.getByText(/첫 글자는/)).toHaveTextContent('사예요');
  });

  describe('한글 IME 가드', () => {
    it('IME 조합 중(isComposing) Enter는 제출되지 않는다', () => {
      const { onSubmit } = renderInput();
      const input = screen.getByRole('textbox', { name: '답 입력' });
      fireEvent.change(input, { target: { value: '공원' } });
      // 조합 중 Enter — isComposing=true.
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('조합 종료 후 Enter는 제출된다', () => {
      const { onSubmit } = renderInput();
      const input = screen.getByRole('textbox', { name: '답 입력' });
      fireEvent.change(input, { target: { value: '공원' } });
      // 조합 완료 후 Enter — isComposing=false.
      fireEvent.keyDown(input, { key: 'Enter', isComposing: false });
      expect(onSubmit).toHaveBeenCalledWith('공원');
    });
  });

  describe('피드백 단계', () => {
    it('정답이면 sage 색상과 ✓를 보인다', () => {
      renderInput({ showFeedback: true, isCorrect: true });
      const input = screen.getByRole('textbox', { name: '답 입력' });
      expect(input.className).toContain('border-[#2D6A56]');
      expect(input.className).toContain('bg-[#EBF4F0]');
      expect(screen.getByText('✓')).toBeInTheDocument();
    });

    it('오답이면 terracotta 색상과 ✗ + 정답을 노출한다', () => {
      renderInput({
        showFeedback: true,
        isCorrect: false,
        correctAnswer: '공원',
      });
      const input = screen.getByRole('textbox', { name: '답 입력' });
      expect(input.className).toContain('border-[#E07B54]');
      expect(input.className).toContain('bg-[#FBE9E2]');
      expect(screen.getByText('✗')).toBeInTheDocument();
      expect(screen.getByText('공원')).toBeInTheDocument();
    });
  });
});
