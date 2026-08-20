import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QabImageItem } from '../../quiz/domain/MixedQuiz.js';
import type { PracticeAttemptInput } from '../domain/Practice.js';
import type { UsePracticeDeps } from '../application/usePracticeSession.js';
import { PracticeScreen } from './PracticeScreen.js';

/**
 * 연습 화면 테스트.
 *
 * 훅 테스트가 "상태에 판정이 없다"를 지킨다면, 여기서는 **화면에 판정이
 * 그려지지 않는다**를 지킨다. 상태에 없어도 문항 컴포넌트가 자기 데이터
 * (choices[].isCorrect)로 정답을 칠할 수 있기 때문에, 화면 쪽 검사가 따로
 * 필요하다.
 */

// 문항 진입 시 TTS가 자동 재생되는데 jsdom엔 speechSynthesis가 없다.
// 기존 컴포넌트 테스트와 같은 방식으로 팩토리만 대체한다.
vi.mock('../../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({
    speak: vi.fn().mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 }),
    cancel: vi.fn(),
  }),
}));

const imageItem = (id: string): QabImageItem => ({
  itemId: id,
  category: 'word',
  promptText: '사과',
  instruction: '들으신 낱말의 그림을 골라주세요',
  choices: [
    { choiceId: id + '_ok', label: '사과', imageUrl: '/a.png', isCorrect: true },
    { choiceId: id + '_no', label: '배', imageUrl: '/b.png', isCorrect: false },
  ],
});

describe('PracticeScreen', () => {
  let submitted: PracticeAttemptInput[];

  const deps = (over?: Partial<UsePracticeDeps>): UsePracticeDeps => ({
    practiceApi: {
      submitResults: (_token, results) => {
        submitted.push(...results);
        return Promise.resolve({ saved: results.length });
      },
    },
    pickQabItems: ((n: number) =>
      Array.from({ length: n }, (_, i) =>
        imageItem('img_' + String(i)),
      )) as UsePracticeDeps['pickQabItems'],
    pickSpellItems: (() => []) as UsePracticeDeps['pickSpellItems'],
    generateSessionToken: () => 'tok-1',
    imageChoiceCount: 2,
    spellCount: 0,
    ...over,
  });

  beforeEach(() => {
    submitted = [];
  });

  /**
   * 화면을 띄우고 렌더 직후의 비동기 상태 갱신을 비운다.
   *
   * 선택지 그림은 로딩/실패를 자체 상태로 관리하는데, jsdom은 이미지를 실제로
   * 불러오지 않아 onError가 렌더 직후 비동기로 떨어진다. 비우지 않으면 act 경고가
   * 남는다.
   */
  const renderScreen = async (
    props: Parameters<typeof PracticeScreen>[0],
  ): Promise<ReturnType<typeof render>> => {
    const utils = render(<PracticeScreen {...props} />);
    await act(async () => {
      await Promise.resolve();
    });
    return utils;
  };

  describe('판정을 그리지 않는다', () => {
    it('오답을 골라도 정오답 문구가 없다', async () => {
      await renderScreen({ onExit: () => undefined, deps: deps() });

      fireEvent.click(screen.getByLabelText('배 선택'));

      expect(screen.queryByText(/정답/)).toBeNull();
      expect(screen.queryByText(/아쉬/)).toBeNull();
      expect(screen.queryByText(/틀렸/)).toBeNull();
      expect(screen.getByText('잘하고 계세요')).toBeInTheDocument();
    });

    it('정답을 골라도 오답을 고른 것과 같은 문구가 나온다', async () => {
      const { unmount } = await renderScreen({
        onExit: () => undefined,
        deps: deps(),
      });
      fireEvent.click(screen.getByLabelText('사과 선택'));
      const afterCorrect = screen.getByRole('status').textContent;
      unmount();

      await renderScreen({ onExit: () => undefined, deps: deps() });
      fireEvent.click(screen.getByLabelText('배 선택'));
      const afterWrong = screen.getByRole('status').textContent;

      expect(afterCorrect).toBe(afterWrong);
    });

    it('정답 표시 아이콘(✓/✗)이 나타나지 않는다', async () => {
      const { container } = await renderScreen({
        onExit: () => undefined,
        deps: deps(),
      });

      fireEvent.click(screen.getByLabelText('배 선택'));

      expect(container.textContent).not.toContain('✓');
      expect(container.textContent).not.toContain('✗');
    });
  });

  describe('진행', () => {
    it('답하면 다음 버튼이 나오고, 눌러야 넘어간다', async () => {
      await renderScreen({ onExit: () => undefined, deps: deps() });

      expect(screen.queryByLabelText('다음 문제')).toBeNull();
      fireEvent.click(screen.getByLabelText('사과 선택'));

      fireEvent.click(screen.getByLabelText('다음 문제'));
      // 새 문항의 그림이 마운트되며 같은 비동기 갱신이 한 번 더 일어난다.
      await act(async () => {
        await Promise.resolve();
      });

      // 두 번째(마지막) 문항 — 답하면 버튼 문구가 바뀐다.
      fireEvent.click(screen.getByLabelText('사과 선택'));
      expect(screen.getByLabelText('연습 마치기')).toBeInTheDocument();
    });

    it('마치면 점수를 보여주지 않는다', async () => {
      const { container } = await renderScreen({
        onExit: () => undefined,
        deps: deps({ imageChoiceCount: 1 }),
      });

      fireEvent.click(screen.getByLabelText('사과 선택'));
      fireEvent.click(screen.getByLabelText('연습 마치기'));

      expect(screen.getByText('오늘 연습 끝!')).toBeInTheDocument();
      // 점수를 세는 순간 연습이 시험이 된다 — 숫자도 백분율도 없어야 한다.
      expect(container.textContent).not.toMatch(/\d+\s*[%점]/);
      expect(container.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
    });

    it('그만하기로 중간에 나가면 그때까지가 저장된다', async () => {
      const onExit = vi.fn();
      await renderScreen({ onExit, deps: deps() });

      fireEvent.click(screen.getByLabelText('사과 선택'));
      fireEvent.click(screen.getByLabelText('다음 문제'));
      fireEvent.click(screen.getByLabelText('오늘은 그만하기'));

      expect(screen.getByText('오늘 연습 끝!')).toBeInTheDocument();
      await waitFor(() => {
        // "다음"과 "그만하기"를 연달아 누르면 앞 제출이 끝나기 전에 다음 flush가
        // 돌아 같은 시도가 두 번 나갈 수 있다. 서버가 (session, item, attempt)
        // UNIQUE + ON CONFLICT DO NOTHING이라 no-op이므로, 여기서는 **무엇이
        // 저장됐는지**만 본다.
        const refs = new Set(submitted.map((r) => r.itemRef));
        expect(refs.size).toBe(1);
      });
    });

    // Regression: ISSUE-001 — 4지선다 그림 문항에서 답한 뒤 "다음 문제"가 화면
    // 밖(720px 높이 기준 y=888)에 있어 앞으로 갈 방법이 안 보였다.
    // Found by /qa on 2026-08-20
    // Report: .gstack/qa-reports/qa-report-localhost-5173-2026-08-20.md
    it('답하면 다음 버튼을 화면 안으로 끌어온다', async () => {
      const scrollIntoView = vi.fn();
      // jsdom에는 scrollIntoView가 아예 없어서 정의부터 해야 한다.
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        value: scrollIntoView,
        configurable: true,
        writable: true,
      });

      await renderScreen({ onExit: () => undefined, deps: deps() });
      expect(scrollIntoView).not.toHaveBeenCalled();

      fireEvent.click(screen.getByLabelText('사과 선택'));

      // block:'nearest'라야 이미 보이는 화면에서는 아무 일도 안 한다.
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        behavior: 'smooth',
      });

      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('마치기를 누르면 밖으로 나간다', async () => {
      const onExit = vi.fn();
      await renderScreen({ onExit, deps: deps({ imageChoiceCount: 1 }) });

      fireEvent.click(screen.getByLabelText('사과 선택'));
      fireEvent.click(screen.getByLabelText('연습 마치기'));
      fireEvent.click(screen.getByRole('button', { name: '마치기' }));

      expect(onExit).toHaveBeenCalledOnce();
    });
  });
});
