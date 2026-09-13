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
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { SpeechCaptureItem } from './SpeechCaptureItem.js';
import { TTS_FAILURE_MESSAGE_KEY } from './TtsFailureNotice.js';
import { i18n } from '../../../../../shared/i18n/i18n.js';

/** 안내 문구 — 테스트 셋업의 활성 로케일(한국어) 값. */
const TTS_FAILURE_MESSAGE = i18n.t(TTS_FAILURE_MESSAGE_KEY, { ns: 'quiz' });

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

// TTS는 서버/브라우저 구현 선택을 팩토리가 담당하므로 팩토리를 목으로 대체한다.
vi.mock('../../../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({
    speak: ttsSpeak.mockResolvedValue({
      startTime: 0,
      endTime: 0,
      durationMs: 0,
    }),
    cancel: vi.fn(),
  }),
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
  const onOverride = vi.fn();
  render(
    <SpeechCaptureItem
      text={overrides?.text ?? '오늘 날씨가 좋아요'}
      instruction="따라 말해주세요"
      showModel={overrides?.showModel ?? true}
      isSelectable={overrides?.isSelectable ?? true}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrect={overrides?.isCorrect ?? null}
      onSubmit={onSubmit}
      onOverride={onOverride}
    />,
  );
  return { onSubmit, onOverride };
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
    // WebSpeech 폴백 경로라 음소 점수는 없다(azure=null).
    expect(onSubmit).toHaveBeenCalledWith('오늘 날씨가 좋아요', null, {
      unheard: false,
    });
  });

  it('넘어가기를 누르면 목표 텍스트로 통과 처리한다', () => {
    const { onSubmit } = renderItem({ text: '오늘 날씨가 좋아요' });
    fireEvent.click(screen.getByRole('button', { name: '넘어가기' }));
    expect(onSubmit).toHaveBeenCalledWith('오늘 날씨가 좋아요', null, {
      unheard: false,
    });
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

describe('SpeechCaptureItem — 소리 실패 안내', () => {
  beforeEach(() => {
    sttInstances.length = 0;
    ttsSpeak.mockClear();
  });

  it('모범 발음이 안 나면 환자에게 알린다', async () => {
    ttsSpeak.mockRejectedValueOnce(new Error('TTS 502'));
    renderItem({ showModel: true, text: '바다' });

    fireEvent.click(screen.getByRole('button', { name: '모범 발음 들어보기' }));

    expect(await screen.findByText(TTS_FAILURE_MESSAGE)).toBeInTheDocument();
  });

  it('스스로 읽기(showModel=false)에는 안내가 뜨지 않는다', async () => {
    // 들어보기 버튼이 없는 과제다. 누른 적 없는 소리의 실패를 알릴 이유가 없다.
    ttsSpeak.mockRejectedValueOnce(new Error('TTS 502'));
    renderItem({ showModel: false });

    await waitFor(() => expect(ttsSpeak).not.toHaveBeenCalled());
    expect(screen.queryByText(TTS_FAILURE_MESSAGE)).toBeNull();
  });
});
