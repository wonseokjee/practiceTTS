// SpeechInput.tsx — 따라읽기(음성) 테스트
//
// STT/TTS 서비스를 목으로 대체해 흐름을 제어한다.
// 검증 포인트:
//  - targetWord를 화면에 표시
//  - 🔊 들어보기 → TTS.speak(word)
//  - 🎤 따라 말하기 → STT.start
//  - 인식 성공(onResult) → 인식 텍스트 표시 + 제출 → onSubmit(인식 텍스트)
//  - 인식 실패(onError) → 에러 메시지, 제출 버튼 미노출
//  - 넘어가기 → onSubmit(targetWord) (보호자 통과 처리)
//  - 피드백 단계: 정답/오답 색상 + 정답 노출, 컨트롤 숨김

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { SpeechInput } from './SpeechInput.js';
import { TTS_FAILURE_MESSAGE_KEY } from './TtsFailureNotice.js';
import { i18n } from '../../../../../shared/i18n/i18n.js';

/** 안내 문구 — 테스트 셋업의 활성 로케일(한국어) 값. */
const TTS_FAILURE_MESSAGE = i18n.t(TTS_FAILURE_MESSAGE_KEY, { ns: 'quiz' });

interface MockSttInstance {
  onResult: ((r: { transcript: string; confidence: number }) => void) | null;
  onError: ((m: string) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
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
    cancel = vi.fn();
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
  targetWord?: string | null;
  isSelectable?: boolean;
  showFeedback?: boolean;
  isCorrect?: boolean | null;
  correctAnswer?: string | null;
}

function renderInput(overrides?: Overrides) {
  const onSubmit = vi.fn();
  render(
    <SpeechInput
      targetWord={overrides?.targetWord ?? '바다'}
      isSelectable={overrides?.isSelectable ?? true}
      showFeedback={overrides?.showFeedback ?? false}
      isCorrect={overrides?.isCorrect ?? null}
      correctAnswer={overrides?.correctAnswer ?? null}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe('SpeechInput (따라읽기)', () => {
  beforeEach(() => {
    sttInstances.length = 0;
    ttsSpeak.mockClear();
  });

  it('따라 읽을 단어를 화면에 표시한다', () => {
    renderInput({ targetWord: '바다' });
    expect(
      screen.getByLabelText('따라 읽을 단어: 바다'),
    ).toBeInTheDocument();
  });

  it('들어보기를 누르면 TTS가 단어를 발음한다', () => {
    renderInput({ targetWord: '바다' });
    fireEvent.click(screen.getByRole('button', { name: '모범 발음 들어보기' }));
    expect(ttsSpeak).toHaveBeenCalledWith('바다');
  });

  it('따라 말하기를 누르면 STT 인식을 시작한다', () => {
    renderInput();
    fireEvent.click(screen.getByRole('button', { name: '따라 말하기' }));
    expect(sttInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it('말하기 중 "다 말했어요"를 누르면 STT 인식을 종료한다(서버 STT 자동종료 대체)', () => {
    renderInput();
    fireEvent.click(screen.getByRole('button', { name: '따라 말하기' }));
    // 녹음 중에는 마이크 버튼이 "다 말했어요"로 바뀐다.
    fireEvent.click(screen.getByRole('button', { name: '다 말했어요' }));
    expect(sttInstances[0].stop).toHaveBeenCalledTimes(1);
  });

  it('인식 성공 후 제출하면 onSubmit이 인식 텍스트로 호출된다', () => {
    const { onSubmit } = renderInput({ targetWord: '바다' });
    fireEvent.click(screen.getByRole('button', { name: '따라 말하기' }));
    act(() => {
      sttInstances[0].onResult?.({ transcript: '바다', confidence: 0.9 });
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    expect(onSubmit).toHaveBeenCalledWith('바다');
  });

  it('인식 실패 시 에러 메시지를 표시하고 제출 버튼은 나타나지 않는다', () => {
    renderInput();
    fireEvent.click(screen.getByRole('button', { name: '따라 말하기' }));
    act(() => {
      sttInstances[0].onError?.('음성이 감지되지 않았습니다.');
    });
    expect(screen.getByText('음성이 감지되지 않았습니다.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '제출' }),
    ).not.toBeInTheDocument();
  });

  it('넘어가기를 누르면 보여준 단어로 통과 처리한다', () => {
    const { onSubmit } = renderInput({ targetWord: '바다' });
    fireEvent.click(screen.getByRole('button', { name: '넘어가기' }));
    expect(onSubmit).toHaveBeenCalledWith('바다');
  });

  describe('피드백 단계', () => {
    it('정답이면 ✓를 보이고 컨트롤을 숨긴다', () => {
      renderInput({ showFeedback: true, isCorrect: true });
      expect(screen.getByText('✓')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: '따라 말하기' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: '넘어가기' }),
      ).not.toBeInTheDocument();
    });

    it('오답이면 ✗와 정답을 노출한다', () => {
      // targetWord와 correctAnswer를 다르게 주어 정답 노출만 콕 집어 검증한다.
      renderInput({
        showFeedback: true,
        isCorrect: false,
        targetWord: '산',
        correctAnswer: '바다',
      });
      expect(screen.getByText('✗')).toBeInTheDocument();
      expect(screen.getByText('바다')).toBeInTheDocument();
    });
  });
});

describe('SpeechInput — 소리 실패 안내', () => {
  beforeEach(() => {
    sttInstances.length = 0;
    ttsSpeak.mockClear();
  });

  it('모범 발음이 안 나면 환자에게 알린다', async () => {
    // 못 들은 발음은 따라 할 수 없다. 조용히 실패하면 환자는 자기 귀를 의심한다.
    ttsSpeak.mockRejectedValueOnce(new Error('TTS 502'));
    renderInput({ targetWord: '바다' });

    fireEvent.click(screen.getByRole('button', { name: '모범 발음 들어보기' }));

    expect(await screen.findByText(TTS_FAILURE_MESSAGE)).toBeInTheDocument();
  });

  it('소리가 나면 안내가 없다', async () => {
    renderInput({ targetWord: '바다' });

    fireEvent.click(screen.getByRole('button', { name: '모범 발음 들어보기' }));

    await waitFor(() => expect(ttsSpeak).toHaveBeenCalled());
    expect(screen.queryByText(TTS_FAILURE_MESSAGE)).toBeNull();
  });
});
