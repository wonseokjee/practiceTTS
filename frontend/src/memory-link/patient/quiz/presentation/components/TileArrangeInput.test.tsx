// TileArrangeInput.tsx — 글자 타일 조합 입력 테스트
//
// 검증 포인트:
//  - 타일 탭 → 조합 결과 누적, 같은 음절 타일은 인덱스 단위로 1회만 사용
//  - 제출 시 onSubmit(조합 문자열)
//  - "한 글자 지우기" / "모두 지우기"
//  - 아무것도 안 고르면 제출 비활성화
//  - hintFirstChar 표시
//  - 피드백 단계: 정답/오답 색상 + 정답 노출, 타일 숨김
//
// 넘어가기(onSkip)는 없다 — 예전엔 데일리 `tile_arrange` 문항에만 있었는데
// 그 유형이 은퇴하며(#48) 함께 없어졌다. 지금 유일한 사용처(SpellTileItem)는
// 자기 넘어가기 버튼을 이 컴포넌트 바깥에 따로 둔다.

import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TileArrangeInput } from './TileArrangeInput.js';

interface Overrides {
  tiles?: string[];
  isSelectable?: boolean;
  showFeedback?: boolean;
  isCorrect?: boolean | null;
  correctAnswer?: string | null;
  hintFirstChar?: string | null;
}

function renderInput(overrides?: Overrides) {
  const onSubmit = vi.fn();
  render(
    <TileArrangeInput
      tiles={overrides?.tiles ?? ['다', '바', '산', '강']}
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

describe('TileArrangeInput', () => {
  it('타일을 순서대로 탭해 조합한 문자열을 제출한다', () => {
    const { onSubmit } = renderInput({ tiles: ['다', '바', '산'] });
    fireEvent.click(screen.getByRole('button', { name: '바 글자 넣기' }));
    fireEvent.click(screen.getByRole('button', { name: '다 글자 넣기' }));
    fireEvent.click(screen.getByRole('button', { name: '답 제출' }));
    expect(onSubmit).toHaveBeenCalledWith('바다');
  });

  it('중복 음절 타일은 각 인덱스가 독립적으로 사용된다 (예: 바나나)', () => {
    const { onSubmit } = renderInput({ tiles: ['나', '바', '나'] });
    const naTiles = screen.getAllByRole('button', { name: '나 글자 넣기' });
    fireEvent.click(screen.getByRole('button', { name: '바 글자 넣기' }));
    fireEvent.click(naTiles[0]);
    fireEvent.click(naTiles[1]);
    fireEvent.click(screen.getByRole('button', { name: '답 제출' }));
    expect(onSubmit).toHaveBeenCalledWith('바나나');
  });

  it('"한 글자 지우기"는 마지막 글자를 제거한다', () => {
    const { onSubmit } = renderInput({ tiles: ['다', '바'] });
    fireEvent.click(screen.getByRole('button', { name: '바 글자 넣기' }));
    fireEvent.click(screen.getByRole('button', { name: '다 글자 넣기' }));
    fireEvent.click(screen.getByRole('button', { name: '한 글자 지우기' }));
    fireEvent.click(screen.getByRole('button', { name: '답 제출' }));
    expect(onSubmit).toHaveBeenCalledWith('바');
  });

  it('"모두 지우기"는 조합을 초기화한다', () => {
    renderInput({ tiles: ['다', '바'] });
    fireEvent.click(screen.getByRole('button', { name: '바 글자 넣기' }));
    fireEvent.click(screen.getByRole('button', { name: '모두 지우기' }));
    expect(screen.getByRole('button', { name: '답 제출' })).toBeDisabled();
  });

  it('아무 타일도 고르지 않으면 제출 버튼이 비활성화된다', () => {
    renderInput();
    expect(screen.getByRole('button', { name: '답 제출' })).toBeDisabled();
  });

  it('hintFirstChar가 있으면 첫 글자 힌트를 표시한다', () => {
    // 힌트 글자는 타일에 없는 음절을 써서 타일 버튼 텍스트와 충돌하지 않게 한다.
    renderInput({ hintFirstChar: '공', tiles: ['다', '바', '산'] });
    expect(screen.getByText('공')).toBeInTheDocument();
  });

  // Found by browser QA on 2026-08-21 (연습 모드에서 같은 버그를 먼저 발견).
  it('힌트 글자의 받침에 따라 조사가 달라진다', () => {
    renderInput({ hintFirstChar: '공', tiles: ['다', '바', '산'] });
    expect(screen.getByText(/첫 글자는/)).toHaveTextContent('공이에요');

    cleanup();
    renderInput({ hintFirstChar: '사', tiles: ['다', '바', '산'] });
    expect(screen.getByText(/첫 글자는/)).toHaveTextContent('사예요');
  });

  describe('피드백 단계', () => {
    it('정답이면 sage 색상과 ✓를 보이고 타일을 숨긴다', () => {
      renderInput({ showFeedback: true, isCorrect: true, tiles: ['바', '다'] });
      expect(screen.getByText('✓')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: '바 글자 넣기' }),
      ).not.toBeInTheDocument();
    });

    it('오답이면 ✗와 정답을 노출한다', () => {
      renderInput({
        showFeedback: true,
        isCorrect: false,
        correctAnswer: '바다',
      });
      expect(screen.getByText('✗')).toBeInTheDocument();
      expect(screen.getByText('바다')).toBeInTheDocument();
    });
  });
});
