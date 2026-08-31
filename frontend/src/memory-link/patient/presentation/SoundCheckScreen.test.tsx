import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundCheckScreen } from './SoundCheckScreen.js';

/**
 * 소리 사전 점검 화면.
 *
 * 지키는 불변식은 셋이다.
 *  - **들려주기 전에 묻지 않는다** — 재생이 끝나야 예/아니오가 뜬다.
 *  - **재생이 실패하면 묻지 않는다** — 답은 이미 정해져 있다. 바로 안내로 간다.
 *  - **막지 않는다** — 소리가 끝내 안 나도 나갈 길("소리 없이 시작하기")이 있다.
 */

const ttsSpeak = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 }),
);

vi.mock('../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({ speak: ttsSpeak, cancel: vi.fn() }),
}));

function renderScreen(overrides: Partial<Parameters<typeof SoundCheckScreen>[0]> = {}) {
  const props = {
    onPass: vi.fn(),
    onSkip: vi.fn(),
    onCancel: vi.fn(),
    destination: '연습' as const,
    ...overrides,
  };
  const { container } = render(<SoundCheckScreen {...props} />);
  // props와 함께 container도 돌려준다 — 배치 테스트가 루트 요소를 봐야 한다.
  return { ...props, container };
}

describe('SoundCheckScreen', () => {
  beforeEach(() => {
    ttsSpeak.mockReset();
    ttsSpeak.mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 });
  });

  it('들어오자마자 한 번 들려준다', async () => {
    renderScreen();
    await waitFor(() => {
      expect(ttsSpeak).toHaveBeenCalledWith('소리가 잘 들리시나요?');
    });
  });

  it('재생이 끝나야 들렸는지 묻는다', async () => {
    renderScreen();
    expect(screen.queryByText('소리가 잘 들리셨나요?')).toBeNull();
    await waitFor(() => {
      expect(screen.getByText('소리가 잘 들리셨나요?')).toBeInTheDocument();
    });
  });

  it('"잘 들려요"를 누르면 통과로 넘긴다', async () => {
    const props = renderScreen();
    await screen.findByText('소리가 잘 들리셨나요?');
    fireEvent.click(screen.getByRole('button', { name: '잘 들려요' }));
    expect(props.onPass).toHaveBeenCalledOnce();
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  it('"안 들려요"를 누르면 통과시키지 않고 손으로 할 동작을 안내한다', async () => {
    const props = renderScreen();
    await screen.findByText('소리가 잘 들리셨나요?');
    fireEvent.click(screen.getByRole('button', { name: '안 들려요' }));

    expect(props.onPass).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('소리가 안 들리시는군요');
    expect(screen.getByText(/무음\(진동\) 상태라면/)).toBeInTheDocument();
  });

  it('재생 API가 실패하면 묻지 않고 바로 안내로 간다', async () => {
    ttsSpeak.mockRejectedValue(new Error('둘 다 죽음'));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '이 기기에서 소리를 낼 수 없었어요',
      );
    });
    // 기계가 답을 알고 있으므로 어르신에게 묻지 않는다.
    expect(screen.queryByText('소리가 잘 들리셨나요?')).toBeNull();
    expect(screen.queryByRole('button', { name: '잘 들려요' })).toBeNull();
  });

  it('안내 화면에서도 막지 않는다 — 소리 없이 시작할 수 있다', async () => {
    ttsSpeak.mockRejectedValue(new Error('둘 다 죽음'));
    const props = renderScreen();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: '소리 없이 시작하기' }));
    expect(props.onSkip).toHaveBeenCalledOnce();
    // 통과로 기록하면 안 되므로 onPass는 부르지 않는다.
    expect(props.onPass).not.toHaveBeenCalled();
  });

  it('소리를 켜고 다시 들으면 질문으로 되돌아온다', async () => {
    ttsSpeak.mockRejectedValueOnce(new Error('음소거'));
    renderScreen();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: '소리 듣기' }));
    await waitFor(() => {
      expect(screen.getByText('소리가 잘 들리셨나요?')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('돌아가기는 세션을 시작하지 않는다', async () => {
    const props = renderScreen();
    await screen.findByText('소리가 잘 들리셨나요?');
    fireEvent.click(screen.getByRole('button', { name: '돌아가기' }));
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onPass).not.toHaveBeenCalled();
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  it('어디로 가는 길인지 문구에 담는다', async () => {
    renderScreen({ destination: '검사' });
    expect(
      screen.getByText(/검사에는 듣고 답하는 문제가 있어요/),
    ).toBeInTheDocument();
    // 자동 재생이 끝나기 전에 테스트가 끝나면 act 경고가 난다.
    await screen.findByText('소리가 잘 들리셨나요?');
  });

  // ── 세로 배치 (DR8) ────────────────────────────────────────────
  //
  // 390×844에서 콘텐츠가 503px만 쓰고 아래 342px(40%)이 비어 있었다. 빈 것보다
  // 나쁜 건 기본 동작이 화면 위쪽이라 엄지가 올라가야 했던 것과, `돌아가기`가
  // 답변 버튼 바로 밑에 붙어 있던 것이다.

  it('화면 높이를 채운다', async () => {
    const { container } = renderScreen();
    await screen.findByText('소리가 잘 들리셨나요?');
    const root = container.firstElementChild as HTMLElement;

    // `100vh`가 아니라 `100dvh`다 — vh는 모바일에서 주소창을 포함한 높이라
    // 바닥에 붙인 버튼이 화면 밖으로 밀린다.
    const classes = root.className.split(' ');
    expect(classes).toContain('min-h-dvh');
    expect(classes).not.toContain('min-h-screen');
  });

  it('돌아가기를 답변 버튼과 같은 덩어리에 두지 않는다', async () => {
    const { container } = renderScreen();
    const 답 = await screen.findByText('잘 들려요');
    const 돌아가기 = screen.getByText('돌아가기');

    // 같은 부모에 있으면 손가락이 헷갈린다. 본문은 가운데, 이건 바닥이다.
    expect(돌아가기.parentElement).not.toBe(답.parentElement);
    expect(container.firstElementChild!.lastElementChild).toBe(돌아가기);
  });
});
