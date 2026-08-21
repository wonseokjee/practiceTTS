import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QabImageItem } from '../../quiz/domain/MixedQuiz.js';
import type { PracticeAttemptInput } from '../domain/Practice.js';
import type { UsePracticeDeps } from '../application/usePracticeSession.js';
import { PracticeScreen } from './PracticeScreen.js';

/**
 * 연습 화면 테스트.
 *
 * 지키는 불변식은 둘이다.
 *  - **가르치되 채점하지 않는다** — 정답은 말해주고, 실패 표시(✗·빨강·"틀렸어요")는
 *    쓰지 않는다. 재시도 권유가 그 자리를 대신한다.
 *  - **집계를 노출하지 않는다** — 진행 중에도 종료 화면에도 점수·정답률·개수가
 *    없다. 시험이 되는 지점은 문항별 안내가 아니라 집계다.
 *
 * 2026-08-20 이전에는 "정오답 문구가 아예 없다"를 단언했다. 그 불변식은
 * 의도적으로 뒤집혔다(피드백 없는 드릴은 오답을 강화한다). 남은 것이 위 둘이다.
 */

// 문항 진입 시 TTS가 자동 재생되는데 jsdom엔 speechSynthesis가 없다.
// 기존 컴포넌트 테스트와 같은 방식으로 팩토리만 대체한다.
vi.mock('../../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({
    speak: vi.fn().mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 }),
    cancel: vi.fn(),
  }),
}));

/** 4지선다 — 오답 3개가 있어야 세 번 틀리는 경로를 볼 수 있다. */
const imageItem = (id: string): QabImageItem => ({
  itemId: id,
  category: 'word',
  promptText: '사과',
  instruction: '들으신 낱말의 그림을 골라주세요',
  choices: [
    { choiceId: id + '_ok', label: '사과', imageUrl: '/a.png', isCorrect: true },
    { choiceId: id + '_n1', label: '배', imageUrl: '/b.png', isCorrect: false },
    { choiceId: id + '_n2', label: '감', imageUrl: '/c.png', isCorrect: false },
    { choiceId: id + '_n3', label: '귤', imageUrl: '/d.png', isCorrect: false },
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
    pickWordItems: ((n: number) =>
      Array.from({ length: n }, (_, i) =>
        imageItem('img_' + String(i)),
      )) as UsePracticeDeps['pickWordItems'],
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
    await flush();
    return utils;
  };

  /** 재마운트(재시도·문항 이동) 뒤의 비동기 갱신을 비운다. */
  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  const pick = (label: string): void => {
    fireEvent.click(screen.getByLabelText(`${label} 선택`));
  };

  describe('가르치되 채점하지 않는다', () => {
    it('맞히면 정답을 말해준다', async () => {
      await renderScreen({ onExit: () => undefined, deps: deps() });

      pick('사과');

      expect(screen.getByRole('status')).toHaveTextContent("맞아요, '사과'예요.");
    });

    it('틀리면 판정 대신 다시 권한다', async () => {
      const { container } = await renderScreen({
        onExit: () => undefined,
        deps: deps(),
      });

      pick('배');
      await flush();

      expect(screen.getByRole('status')).toHaveTextContent('다시 한번 해볼까요?');
      // 실패를 이름 붙여 부르지 않는다.
      expect(container.textContent).not.toMatch(/틀렸|아쉬|실패|오답/);
      expect(container.textContent).not.toContain('✗');
      // 아직 정답을 알려줄 때가 아니다 — 알려주면 재시도가 베끼기가 된다.
      expect(container.textContent).not.toContain("'사과'예요");
    });

    it('틀린 뒤에도 모든 선택지를 그대로 고를 수 있다', async () => {
      // 틀린 카드를 잠그지 않는다. 4지선다에서 둘을 잠그면 마지막 시도가
      // 소거법이 되어 "몇 번 만에 됐는가"가 시도마다 다른 척도가 된다.
      await renderScreen({ onExit: () => undefined, deps: deps() });

      pick('배');
      await flush();

      expect(screen.getByLabelText('배 선택')).toBeEnabled();
      expect(screen.getByLabelText('감 선택')).toBeEnabled();
      expect(screen.getByLabelText('사과 선택')).toBeEnabled();
    });

    it('세 번 틀리면 정답을 말해주고 다음으로 보낸다', async () => {
      const { container } = await renderScreen({
        onExit: () => undefined,
        deps: deps(),
      });

      pick('배');
      await flush();
      pick('감');
      await flush();
      pick('귤');
      await flush();

      expect(screen.getByRole('status')).toHaveTextContent("이건 '사과'예요.");
      expect(screen.getByLabelText('다음 문제')).toBeInTheDocument();
      // 세 번 틀려도 실패를 이름 붙여 부르지 않는다.
      expect(container.textContent).not.toMatch(/틀렸|아쉬|실패|오답/);
      expect(container.textContent).not.toContain('✗');
    });

    // Found by browser QA on 2026-08-21: "이건 '칫솔'예요."가 그대로 읽혔다.
    it('받침 있는 낱말이면 조사가 이에요로 바뀐다', async () => {
      const 칫솔 = (): QabImageItem => ({
        ...imageItem('c_0'),
        choices: [
          { choiceId: 'c_0_ok', label: '칫솔', imageUrl: '/a.png', isCorrect: true },
          { choiceId: 'c_0_n1', label: '당근', imageUrl: '/b.png', isCorrect: false },
        ],
      });
      await renderScreen({
        onExit: () => undefined,
        deps: deps({
          pickWordItems: (() => [칫솔()]) as UsePracticeDeps['pickWordItems'],
          imageChoiceCount: 1,
        }),
      });

      pick('칫솔');

      expect(screen.getByRole('status')).toHaveTextContent(
        "맞아요, '칫솔'이에요.",
      );
    });

    it('답하기 전에는 아무 문구도 없다', async () => {
      await renderScreen({ onExit: () => undefined, deps: deps() });

      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByLabelText('다음 문제')).toBeNull();
    });
  });

  describe('집계를 노출하지 않는다', () => {
    it('마치면 점수를 보여주지 않는다', async () => {
      const { container } = await renderScreen({
        onExit: () => undefined,
        deps: deps({ imageChoiceCount: 1 }),
      });

      pick('배');
      await flush();
      pick('사과');
      fireEvent.click(screen.getByLabelText('연습 마치기'));

      expect(screen.getByText('오늘 연습 끝!')).toBeInTheDocument();
      // 점수를 세는 순간 연습이 시험이 된다 — 숫자도 백분율도 없어야 한다.
      expect(container.textContent).not.toMatch(/\d+\s*[%점]/);
      expect(container.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
    });
  });

  describe('진행', () => {
    it('답하면 다음 버튼이 나오고, 눌러야 넘어간다', async () => {
      await renderScreen({ onExit: () => undefined, deps: deps() });

      expect(screen.queryByLabelText('다음 문제')).toBeNull();
      pick('사과');

      fireEvent.click(screen.getByLabelText('다음 문제'));
      await flush();

      // 두 번째(마지막) 문항 — 답하면 버튼 문구가 바뀐다.
      pick('사과');
      expect(screen.getByLabelText('연습 마치기')).toBeInTheDocument();
    });

    it('그만하기로 중간에 나가면 그때까지가 저장된다', async () => {
      const onExit = vi.fn();
      await renderScreen({ onExit, deps: deps() });

      pick('사과');
      fireEvent.click(screen.getByLabelText('다음 문제'));
      await flush();
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

    it('마치기를 누르면 밖으로 나간다', async () => {
      const onExit = vi.fn();
      await renderScreen({ onExit, deps: deps({ imageChoiceCount: 1 }) });

      pick('사과');
      fireEvent.click(screen.getByLabelText('연습 마치기'));
      fireEvent.click(screen.getByRole('button', { name: '마치기' }));

      expect(onExit).toHaveBeenCalledOnce();
    });

    // Regression: ISSUE-001 — 4지선다 그림 문항에서 답한 뒤 문구와 "다음 문제"가
    // 화면 밖(720px 높이 기준 y=888)에 있어 앞으로 갈 방법이 안 보였다.
    // Found by /qa on 2026-08-20
    // Report: .gstack/qa-reports/qa-report-practice-mode-2026-08-20.md
    it('문구가 뜨면 화면 안으로 끌어온다', async () => {
      const scrollIntoView = vi.fn();
      // jsdom에는 scrollIntoView가 아예 없어서 정의부터 해야 한다.
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        value: scrollIntoView,
        configurable: true,
        writable: true,
      });

      await renderScreen({ onExit: () => undefined, deps: deps() });
      expect(scrollIntoView).not.toHaveBeenCalled();

      // 재시도 안내도 화면 밖에 있으면 막다른 길로 보이는 건 마찬가지다.
      pick('배');
      await flush();

      // block:'nearest'라야 이미 보이는 화면에서는 아무 일도 안 한다.
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        behavior: 'smooth',
      });

      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });
  });
});
