// ImageChoiceQuizItem.tsx — 듣고 그림 고르기 테스트
//
// 여기서 지키는 것은 하나다. **소리가 안 나면 환자에게 말한다.**
// 듣기가 이 문항의 전부라, 조용히 실패하면 환자는 자기가 못 들은 건지 기계가
// 안 낸 건지 모른 채 아무거나 찍는다. 그 기록은 "못 알아들었다"로 집계된다.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageChoiceQuizItem } from './ImageChoiceQuizItem.js';
import { TTS_FAILURE_MESSAGE } from './TtsFailureNotice.js';
import type { QabImageItem } from '../../domain/MixedQuiz.js';

const { ttsSpeak } = vi.hoisted(() => ({ ttsSpeak: vi.fn() }));

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

const item = (): QabImageItem => ({
  itemId: 'qw_001',
  category: 'word',
  promptText: '사과',
  instruction: '들려주는 단어의 그림을 골라주세요',
  choices: [
    { choiceId: 'c1', label: '배', imageUrl: '/pear.svg', isCorrect: false },
    { choiceId: 'c2', label: '사과', imageUrl: '/apple.svg', isCorrect: true },
  ],
});

const renderItem = () =>
  render(
    <ImageChoiceQuizItem
      item={item()}
      isSelectable
      showFeedback={false}
      selectedChoiceId={null}
      onSelect={vi.fn()}
    />,
  );

beforeEach(() => {
  ttsSpeak.mockReset();
});

describe('ImageChoiceQuizItem — 소리 실패 안내', () => {
  it('소리가 나면 안내를 띄우지 않는다', async () => {
    renderItem();

    await waitFor(() => expect(ttsSpeak).toHaveBeenCalledWith('사과'));
    expect(screen.queryByText(TTS_FAILURE_MESSAGE)).toBeNull();
  });

  it('소리가 끝내 안 나면 안내를 띄운다', async () => {
    // useTTS의 error는 서버와 브라우저 음성이 **둘 다** 실패해야 찬다.
    // AzureTtsService가 서버 실패를 Web Speech로 받아내기 때문이다.
    ttsSpeak.mockRejectedValueOnce(new Error('TTS 502'));

    renderItem();

    expect(await screen.findByText(TTS_FAILURE_MESSAGE)).toBeInTheDocument();
  });

  it('안내는 즉시 읽히도록 alert로 낸다', async () => {
    ttsSpeak.mockRejectedValueOnce(new Error('TTS 502'));

    renderItem();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(TTS_FAILURE_MESSAGE);
  });

  it('소리가 안 나도 선택지는 계속 고를 수 있다', async () => {
    // 못 들었다고 화면을 막으면 환자가 갇힌다. 채점을 어떻게 볼지는
    // 따로 정할 문제고(TODO-110 후속), 여기서 하는 일은 알리는 것까지다.
    ttsSpeak.mockRejectedValueOnce(new Error('TTS 502'));

    renderItem();

    await screen.findByText(TTS_FAILURE_MESSAGE);
    expect(screen.getByLabelText('사과 선택')).toBeEnabled();
    expect(screen.getByLabelText('배 선택')).toBeEnabled();
  });

  it('다시 눌러 성공하면 안내가 사라진다', async () => {
    ttsSpeak.mockRejectedValueOnce(new Error('TTS 502'));

    renderItem();
    await screen.findByText(TTS_FAILURE_MESSAGE);

    // 듣기 버튼을 다시 누른다 — 문구가 시키는 그대로.
    fireEvent.click(screen.getByLabelText('단어 듣기 다시 듣기'));

    await waitFor(() =>
      expect(screen.queryByText(TTS_FAILURE_MESSAGE)).toBeNull(),
    );
  });
});
