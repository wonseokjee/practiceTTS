// SpeechCaptureItem.tsx — 따라말하기/소리내어읽기 테스트
//
// STT/TTS 서비스를 목으로 대체해 흐름을 제어한다.
// 검증 포인트:
//  - showModel=true → 🔊 들어보기 노출 + TTS.speak(text); false → 미노출
//  - 🎤 말하기 → STT.start
//  - 인식 성공 → 제출 → onSubmit(인식 텍스트)
//  - 넘어가기 → onSubmit(text) (보호자 통과)
//  - 피드백: ✓/✗ + 오답 시 정답 노출

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SpeechCaptureItem } from './SpeechCaptureItem.js';

interface MockSttInstance {
  onResult: ((r: { transcript: string; confidence: number }) => void) | null;
  onError: ((m: string) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const { sttInstances, ttsSpeak } = vi.hoisted(() => ({
  sttInstances: [] as MockSttInstance[],
  ttsSpeak: vi.fn(),
}));

vi.mock('../../../infrastructure/SttService.js', () => {
  class MockStt implements MockSttInstance {
    onResult: MockSttInstance['onResult'] = null;
    onError: MockSttInstance['onError'] = null;
    start = vi.fn();
    stop = vi.fn();
    constructor() {
      sttInstances.push(this);
    }
  }
  return { WebSpeechSttService: MockStt };
});

vi.mock('../../../../../shared/infrastructure/WebSpeechTtsService.js', () => ({
  WebSpeechTtsService: class {
    speak = ttsSpeak.mockResolvedValue({
      startTime: 0,
      endTime: 0,
      durationMs: 0,
    });
    cancel = vi.fn();
    preloadVoice = vi.fn();
  },
}));

interface Overrides {
  text?: string;
  showModel?: boolean;
  isSelectable?: boolean;
  showFeedback?: boolean;
  isCorrect?: boolean | null;
}

function renderItem(overrides?: Overrides) {
  const onSubmit = vi.fn();
  render(
    <SpeechCaptureItem
      text={overrides?.text ?? '오늘 날씨가 좋아요'}
      instruction="따라 말해주세요"
      showModel={overrides?.showModel ?? true}
      isSelectable={overrides?.isSelectable ?? true}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrect={overrides?.isCorrect ?? null}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe('SpeechCaptureItem', () => {
  beforeEach(() => {
    sttInstances.length = 0;
    ttsSpeak.mockClear();
  });

  it('showModel=true면 들어보기로 TTS를 재생한다', () => {
    renderItem({ showModel: true, text: '바다' });
    fireEvent.click(screen.getByRole('button', { name: '모범 발음 들어보기' }));
    expect(ttsSpeak).toHaveBeenCalledWith('바다');
  });

  it('showModel=false면 들어보기 버튼이 없다(스스로 읽기)', () => {
    renderItem({ showModel: false });
    expect(
      screen.queryByRole('button', { name: '모범 발음 들어보기' }),
    ).not.toBeInTheDocument();
  });

  it('말하기 → 인식 성공 → 제출하면 onSubmit이 인식 텍스트로 호출된다', () => {
    const { onSubmit } = renderItem({ text: '오늘 날씨가 좋아요' });
    fireEvent.click(screen.getByRole('button', { name: '말하기' }));
    expect(sttInstances[0].start).toHaveBeenCalledTimes(1);
    act(() => {
      sttInstances[0].onResult?.({ transcript: '오늘 날씨가 좋아요', confidence: 0.9 });
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    expect(onSubmit).toHaveBeenCalledWith('오늘 날씨가 좋아요');
  });

  it('넘어가기를 누르면 목표 텍스트로 통과 처리한다', () => {
    const { onSubmit } = renderItem({ text: '오늘 날씨가 좋아요' });
    fireEvent.click(screen.getByRole('button', { name: '넘어가기' }));
    expect(onSubmit).toHaveBeenCalledWith('오늘 날씨가 좋아요');
  });

  it('피드백 단계: 오답이면 ✗와 정답을 노출하고 컨트롤을 숨긴다', () => {
    renderItem({ showFeedback: true, isCorrect: false, text: '산 위에 해가 떠올라요' });
    expect(screen.getByText('✗')).toBeInTheDocument();
    // 본문 + 정답에 동일 텍스트가 나오므로 "정답:" 라벨로 콕 집어 확인
    expect(screen.getByText(/정답:/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '말하기' }),
    ).not.toBeInTheDocument();
  });
});
