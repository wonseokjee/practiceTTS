// DdkItem.tsx — 말운동(DDK) 테스트
//
// 녹음기(IDdkRecorder)를 목으로 주입해 흐름을 제어한다(Web Audio 불필요).
// 검증 포인트:
//  - 음절 라벨/목표 안내 표시
//  - 시작 → recorder.start, 멈추기 → recorder.stop → 감지 횟수 표시 → 제출(onSubmit(count))
//  - 넘어가기 → onSubmit(targetCount) (보호자 통과)
//  - 피드백: ✓/✗

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DdkItem } from './DdkItem.js';
import type { IDdkRecorder } from '../../infrastructure/DdkRecorder.js';
import type { QabDdkItem } from '../../domain/MixedQuiz.js';

const ITEM: QabDdkItem = {
  itemId: 'ddk_0',
  syllable: '퍼터커',
  label: '퍼-터-커',
  targetCount: 6,
  instruction: '빠르게 반복하세요',
};

function makeRecorder(count: number): IDdkRecorder {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue({ count, durationMs: 5000 }),
  };
}

interface Overrides {
  isSelectable?: boolean;
  showFeedback?: boolean;
  isCorrect?: boolean | null;
  recorder?: IDdkRecorder;
}

function renderItem(overrides?: Overrides) {
  const onSubmit = vi.fn();
  const recorder = overrides?.recorder ?? makeRecorder(8);
  const createRecorder = () => recorder;
  const view = render(
    <DdkItem
      item={ITEM}
      isSelectable={overrides?.isSelectable ?? true}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrect={overrides?.isCorrect ?? null}
      onSubmit={onSubmit}
      createRecorder={createRecorder}
    />,
  );
  const rerender = (props: Partial<Overrides>) =>
    view.rerender(
      <DdkItem
        item={ITEM}
        isSelectable={props.isSelectable ?? true}
        showFeedback={props.showFeedback ?? false}
        isCorrect={props.isCorrect ?? null}
        onSubmit={onSubmit}
        createRecorder={createRecorder}
      />,
    );
  return { onSubmit, recorder, rerender };
}

describe('DdkItem', () => {
  it('음절 라벨과 목표 안내를 표시한다', () => {
    renderItem();
    expect(screen.getByLabelText('반복할 소리: 퍼-터-커')).toBeInTheDocument();
    expect(screen.getByText('6회 이상 반복하면 통과예요.')).toBeInTheDocument();
  });

  it('시작 → 멈추기 → 감지 횟수 표시 → 제출하면 onSubmit(count)', async () => {
    const { onSubmit, recorder } = renderItem({ recorder: makeRecorder(9) });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '시작' }));
    });
    expect(recorder.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '멈추기' }));
    });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText('9회 반복')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    expect(onSubmit).toHaveBeenCalledWith(9);
  });

  it('넘어가기를 누르면 목표 횟수로 통과 처리한다', () => {
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '넘어가기' }));
    expect(onSubmit).toHaveBeenCalledWith(6);
  });

  it('녹음 후 피드백 단계로 가면 ✓와 횟수를 보이고 컨트롤을 숨긴다', async () => {
    const { rerender } = renderItem({ recorder: makeRecorder(7) });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '시작' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '멈추기' }));
    });

    rerender({ showFeedback: true, isCorrect: true });
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByText('7회 반복')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '넘어가기' })).not.toBeInTheDocument();
  });
});
