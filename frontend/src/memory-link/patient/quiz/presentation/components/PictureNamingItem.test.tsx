// PictureNamingItem.tsx — 그림 이름대기 테스트
//
// 발음 평가 캡처 서비스를 목으로 대체해 흐름을 제어한다.
// 검증 포인트:
//  - 안내/그림 표시
//  - 🎤 이름 말하기 → capture.start
//  - 인식 성공 → 제출 → onSubmit(인식 텍스트, azure)
//  - 발음 점수(azure)가 있으면 그대로 상위로 전달
//  - 넘어가기 → onSubmit(targetWord, null) (보호자 통과)
//  - 피드백: ✓/✗ + 오답 시 정답 노출, 컨트롤 숨김

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PictureNamingItem } from './PictureNamingItem.js';
import type { QabNamingItem } from '../../domain/MixedQuiz.js';
import type { AzurePronunciationScores } from '../../domain/pronunciationScore.js';

interface CaptureResult {
  transcript: string;
  azure: AzurePronunciationScores | null;
}
interface MockCaptureInstance {
  onResult: ((r: CaptureResult) => void) | null;
  onError: ((m: string) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

const { sttInstances } = vi.hoisted(() => ({
  sttInstances: [] as MockCaptureInstance[],
}));

vi.mock('../../infrastructure/SpeechCaptureService.js', () => {
  class MockCapture implements MockCaptureInstance {
    onResult: MockCaptureInstance['onResult'] = null;
    onError: MockCaptureInstance['onError'] = null;
    start = vi.fn();
    stop = vi.fn();
    cancel = vi.fn();
    constructor() {
      sttInstances.push(this);
    }
  }
  return { createSpeechCaptureService: () => new MockCapture() };
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
  const onOverride = vi.fn();
  render(
    <PictureNamingItem
      item={ITEM}
      isSelectable={overrides?.isSelectable ?? true}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrect={overrides?.isCorrect ?? null}
      onSubmit={onSubmit}
      onOverride={onOverride}
    />,
  );
  return { onSubmit, onOverride };
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

  it('이름 말하기를 누르면 캡처(발음 평가)를 시작한다', () => {
    renderItem();
    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    // 목표어를 발음 평가 기준으로 넘긴다
    expect(sttInstances[0].start).toHaveBeenCalledWith('사과');
  });

  it('인식 성공 후 제출하면 onSubmit이 (전사, azure)로 호출된다', () => {
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    act(() => {
      sttInstances[0].onResult?.({ transcript: '사과', azure: null });
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    expect(onSubmit).toHaveBeenCalledWith('사과', null);
  });

  it('발음 점수(azure)가 있으면 그대로 상위로 전달한다', () => {
    const azure: AzurePronunciationScores = {
      accuracyScore: 82,
      fluencyScore: 90,
      completenessScore: 100,
      pronunciationScore: 84,
      prosodyScore: null,
    };
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '이름 말하기' }));
    act(() => {
      sttInstances[0].onResult?.({ transcript: '사가', azure });
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    // STT 전사가 '사가'로 어긋나도 azure가 함께 전달돼 상위가 음소로 채점할 수 있다
    expect(onSubmit).toHaveBeenCalledWith('사가', azure);
  });

  it('넘어가기를 누르면 정답 이름으로 통과 처리한다', () => {
    const { onSubmit } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: '넘어가기' }));
    expect(onSubmit).toHaveBeenCalledWith('사과', null);
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

  it('보호자 정정: 오답 판정을 정답으로 뒤집는다', () => {
    const { onOverride } = renderItem({ showFeedback: true, isCorrect: false });
    fireEvent.click(screen.getByRole('button', { name: '정답으로 정정' }));
    expect(onOverride).toHaveBeenCalledWith(true);
  });

  it('보호자 정정: 정답 판정을 오답으로 뒤집는다', () => {
    const { onOverride } = renderItem({ showFeedback: true, isCorrect: true });
    fireEvent.click(screen.getByRole('button', { name: '오답으로 정정' }));
    expect(onOverride).toHaveBeenCalledWith(false);
  });
});
