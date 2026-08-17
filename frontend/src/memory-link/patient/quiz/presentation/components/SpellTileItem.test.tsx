import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpellTileItem } from './SpellTileItem.js';
import type { QabSpellItem } from '../../domain/MixedQuiz.js';

/**
 * 글자 조합 문항 화면 테스트.
 *
 * 이 과제는 예전에 보호자 메모 기반이라 기억 회상과 음절 조합이 한 문항에
 * 겹쳐 있었다. 커리큘럼 기반으로 옮기면서 **그림 단서**를 넣은 게 설계의
 * 핵심이다 — 그림이 없으면 "무슨 낱말을 만들지"부터 알아내야 해서 다시
 * 회상 과제가 된다.
 */
const ITEM: QabSpellItem = {
  itemId: 'spell_w1',
  targetWord: '사과',
  imageUrl: '/apple.svg',
  tiles: ['과', '사'],
  instruction: '글자를 눌러 낱말을 만들어 보세요',
  presentedLevel: 2,
};

function renderItem(over: Partial<Parameters<typeof SpellTileItem>[0]> = {}) {
  const onSubmit = vi.fn();
  const onSkip = vi.fn();
  render(
    <SpellTileItem
      item={ITEM}
      isSelectable
      showFeedback={false}
      isCorrect={null}
      onSubmit={onSubmit}
      onSkip={onSkip}
      {...over}
    />,
  );
  return { onSubmit, onSkip };
}

describe('SpellTileItem', () => {
  it('그림 단서와 안내 문구를 함께 보여준다', () => {
    // 그림이 빠지면 회상 과제로 되돌아간다 — 이 재설계가 없애려던 문제다.
    renderItem();

    expect(screen.getByAltText('낱말을 만들 그림')).toHaveAttribute(
      'src',
      '/apple.svg',
    );
    expect(
      screen.getByText('글자를 눌러 낱말을 만들어 보세요'),
    ).toBeInTheDocument();
  });

  it('타일을 누른 순서대로 조합해 제출한다', () => {
    const { onSubmit } = renderItem();

    fireEvent.click(screen.getByLabelText('사 글자 넣기'));
    fireEvent.click(screen.getByLabelText('과 글자 넣기'));
    fireEvent.click(screen.getByLabelText('답 제출'));

    expect(onSubmit).toHaveBeenCalledWith('사과');
  });

  it('피드백 단계에서는 넘어가기를 감춘다', () => {
    // 이미 채점된 문항을 도움받음으로 되돌릴 수 없어야 한다.
    renderItem({ showFeedback: true, isCorrect: false });

    expect(screen.queryByRole('button', { name: '넘어가기' })).toBeNull();
  });

  it('보호자가 넘어가기로 통과시킬 수 있다', () => {
    const { onSkip } = renderItem();

    fireEvent.click(screen.getByLabelText('넘어가기'));

    expect(onSkip).toHaveBeenCalled();
  });

  it('첫 글자 힌트를 노출하지 않는다', () => {
    // 타일에 정답 음절이 이미 다 들어 있어, 레벨 1~2(방해 0개)에서 힌트까지
    // 주면 사실상 정답 공개다.
    renderItem();

    expect(screen.queryByText(/힌트: 첫 글자/)).toBeNull();
  });
});
