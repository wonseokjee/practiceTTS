// PictureNamingItem.tsx — 그림 이름대기 테스트
//
// STT 서비스를 목으로 대체해 흐름을 제어한다.
// 검증 포인트:
//  - 안내/그림 표시
//  - 🎤 이름 말하기 → STT.start
//  - 인식 성공 → 제출 → onSubmit(인식 텍스트)
//  - 넘어가기 → onSubmit(targetWord) (보호자 통과)
//  - 피드백: ✓/✗ + 오답 시 정답 노출, 컨트롤 숨김

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PictureNamingItem } from './PictureNamingItem.js';
import type { QabNamingItem } from '../../domain/MixedQuiz.js';

interface MockSttInstance {
  onResult: ((r: { transcript: string; confidence: number }) => void) | null;
  onError: ((m: string) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

const { sttInstances } = vi.hoisted(() => ({
  sttInstances: [] as MockSttInstance[],
}));

vi.mock('../../../infrastructure/SttService.js', () => {
  class MockStt implements MockSttInstance {
    onResult: MockSttInstance['onResult'] = null;
    onError: MockSttInstance['onError'] = null;
    start = vi.fn();
    stop = vi.fn();
    cancel = vi.fn();
    constructor() {
      sttInstances.push(this);
    }
  }
  return { WebSpeechSttService: MockStt };
});

const ITEM: QabNamingItem = {
  itemId: 'naming_q1',
  imageUrl: '/apple.svg',
  targetWord: '사과',
  instruction: '그림을 보고 이름을 말해주세요',
};

interface Overrides {
  isSelectable?: boolean;
  showFeedback?: boolean;
  isCorrect?: boolean | null;
}

function renderItem(overrides?: Overrides) {
  const onSubmit = vi.fn();
  render(
    <PictureNamingItem
      item={ITEM}
      isSelectable={overrides?.isSelectable ?? true}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrect={overrides?.isCorrect ?? null}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe('PictureNamingItem', () => {
  beforeEach(() => {
    sttInstances.length = 0;
  });

  it('안내와 그림을 표시한다', () => {
    renderItem();
    expect(screen.getByText('그림을 보고 이름을 말해주세요')).toBeInTheDocument();
    expect(screen.getByAltText('이름을 말할 그림')).toBeInTheDocument();
  });

  it('이름 말하기를 누르면 STT 인식을 시작한다', () => {
    renderItem();
    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    expect(sttInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it('인식 성공 후 제출하면 onSubmit이 인식 텍스트로 호출된다', () => {
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    act(() => {
      sttInstances[0].onResult?.({ transcript: '사과', confidence: 0.9 });
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    expect(onSubmit).toHaveBeenCalledWith('사과');
  });

  it('넘어가기를 누르면 정답 이름으로 통과 처리한다', () => {
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '넘어가기' }));
    expect(onSubmit).toHaveBeenCalledWith('사과');
  });

  it('피드백 단계: 정답이면 ✓, 컨트롤 숨김', () => {
    renderItem({ showFeedback: true, isCorrect: true });
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '이름 말하기' }),
    ).not.toBeInTheDocument();
  });

  it('피드백 단계: 오답이면 ✗와 정답을 노출', () => {
    renderItem({ showFeedback: true, isCorrect: false });
    expect(screen.getByText('✗')).toBeInTheDocument();
    expect(screen.getByText('사과')).toBeInTheDocument();
  });
});
