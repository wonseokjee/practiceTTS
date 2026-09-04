import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PracticeWordChoiceItem } from '../../domain/practiceWordChoice.js';
import { WordChoiceItem } from './WordChoiceItem.js';

/**
 * 낱말 고르기 렌더러.
 *
 * 연습 전용이라 검사 규칙이 섞일 여지가 없다. 지키는 것은 하나 —
 * **정답만 표시하고 오답은 칠하지 않는다.**
 */
const item = (): PracticeWordChoiceItem => ({
  itemId: 'wc_qw_001',
  imageUrl: '/apple.svg',
  instruction: '그림에 맞는 낱말을 골라주세요',
  choices: [
    { choiceId: 'c1', label: '배', isCorrect: false },
    { choiceId: 'c2', label: '사과', isCorrect: true },
  ],
});

const renderItem = (over?: {
  isSelectable?: boolean;
  showAnswer?: boolean;
  selectedChoiceId?: string | null;
}) => {
  const onSelect = vi.fn();
  const utils = render(
    <WordChoiceItem
      item={item()}
      isSelectable={over?.isSelectable ?? true}
      showAnswer={over?.showAnswer ?? false}
      selectedChoiceId={over?.selectedChoiceId ?? null}
      onSelect={onSelect}
    />,
  );
  return { onSelect, ...utils };
};

describe('WordChoiceItem', () => {
  it('낱말을 버튼으로 내고 누르면 choiceId를 올린다', () => {
    const { onSelect } = renderItem();

    fireEvent.click(screen.getByLabelText('사과 선택'));

    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  it('그림은 라벨을 흘리지 않는다', () => {
    // alt에 낱말을 넣으면 스크린리더에 정답이 그대로 읽힌다.
    const { container } = renderItem();
    const img = container.querySelector('img');

    expect(img?.getAttribute('src')).toBe('/apple.svg');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('공개 전에는 어떤 선택지도 정답으로 보이지 않는다', () => {
    const { container } = renderItem({ selectedChoiceId: 'c1' });

    // 고른 표시(테두리)는 있어도 정답 배경은 없어야 한다.
    expect(container.innerHTML).not.toContain('primary-light');
  });

  it('공개 단계에서 정답만 강조하고 오답에는 표시가 없다', () => {
    renderItem({ showAnswer: true, selectedChoiceId: 'c1' });

    expect(screen.getByLabelText('사과 선택').className).toContain('primary');
    // 내가 고른 오답을 테라코타로 칠하지 않는다 — 성적표가 아니다.
    expect(screen.getByLabelText('배 선택').className).not.toContain('accent');
  });

  it('선택 불가일 때는 눌러도 올라가지 않는다', () => {
    const { onSelect } = renderItem({ isSelectable: false });

    expect(screen.getByLabelText('사과 선택')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('사과 선택'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
