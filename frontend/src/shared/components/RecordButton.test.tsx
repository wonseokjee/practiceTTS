/**
 * RecordButton 컴포넌트 테스트.
 *
 * 검증 대상:
 * (a) 기본 렌더링 (idle 상태) — "녹음" 라벨과 세이지 그린 테두리 확인
 * (b) disabled 상태 — 버튼이 비활성화되고 클릭해도 녹음이 시작되지 않음
 * (c) onTranscribed 콜백 호출 — useWhisperSTT mock으로 전체 흐름 검증
 *
 * 모킹 전략:
 * - useWhisperSTT를 vi.mock으로 격리하여 MediaRecorder/fetch 없이 UI만 검증
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordButton } from './RecordButton.js';

// ---- useWhisperSTT Mock ----
// 테스트마다 다른 반환값을 주입하기 위해 factory 참조를 모듈 스코프에 둔다.
const mockStartRecording = vi.fn();
const mockStopAndTranscribe = vi.fn();
const mockReset = vi.fn();
let mockState = {
  isRecording: false,
  isTranscribing: false,
  transcript: '',
  error: null as string | null,
};
let lastOnTranscribed: ((text: string) => void) | undefined;

vi.mock('../hooks/useWhisperSTT.js', () => ({
  useWhisperSTT: (options: { onTranscribed?: (text: string) => void }) => {
    // 마운트 시점마다 최신 onTranscribed 콜백을 저장하여 stopAndTranscribe에서 호출한다.
    lastOnTranscribed = options.onTranscribed;
    return {
      ...mockState,
      startRecording: async () => {
        await mockStartRecording();
      },
      stopAndTranscribe: async () => {
        const text = await mockStopAndTranscribe();
        if (text && lastOnTranscribed) {
          lastOnTranscribed(text);
        }
        return text;
      },
      reset: mockReset,
    };
  },
}));

beforeEach(() => {
  mockStartRecording.mockReset();
  mockStopAndTranscribe.mockReset();
  mockReset.mockReset();
  mockState = {
    isRecording: false,
    isTranscribing: false,
    transcript: '',
    error: null,
  };
  lastOnTranscribed = undefined;
});

describe('RecordButton', () => {
  it('(a) 기본 렌더링: idle 상태에서 "녹음" 텍스트와 버튼이 표시된다', () => {
    render(<RecordButton onTranscribed={vi.fn()} />);

    const button = screen.getByRole('button', { name: /녹음/ });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    // 세이지 그린 테두리 클래스 적용 여부
    expect(button.className).toContain('border-[#2D6A56]');
  });

  it('(b) disabled=true면 버튼이 비활성화되고 startRecording이 호출되지 않는다', () => {
    render(<RecordButton onTranscribed={vi.fn()} disabled />);

    const button = screen.getByRole('button', { name: /녹음/ });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it('(c) 녹음 종료 후 transcribe가 성공하면 onTranscribed 콜백이 호출된다', async () => {
    const onTranscribed = vi.fn();
    mockStopAndTranscribe.mockResolvedValue('안녕하세요');

    // 녹음 상태로 렌더링되도록 mock 상태를 미리 설정
    mockState.isRecording = true;

    render(<RecordButton onTranscribed={onTranscribed} />);

    // 녹음 중 버튼 클릭 → stopAndTranscribe 호출
    const button = screen.getByRole('button', { name: /녹음 중/ });
    fireEvent.click(button);

    // 비동기 콜백 완료 대기
    await waitFor(() => {
      expect(mockStopAndTranscribe).toHaveBeenCalledTimes(1);
      expect(onTranscribed).toHaveBeenCalledWith('안녕하세요');
    });
  });
});
