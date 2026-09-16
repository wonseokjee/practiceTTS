// 연습 모드 화면을 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.
// 정답 문구의 받침 처리(copulaSuffix)는 한국어에서만 붙는다 — 영어는
// 그냥 따옴표로 감싼 답만 나온다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { i18n } from '../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import type { QabImageItem } from '../../quiz/domain/MixedQuiz.js';
import type { UsePracticeDeps } from '../application/usePracticeSession.js';
import { PracticeScreen } from './PracticeScreen.js';

vi.mock('../../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({
    speak: vi.fn().mockResolvedValue({ startTime: 0, endTime: 0, durationMs: 0 }),
    cancel: vi.fn(),
  }),
}));

const HANGUL = /[가-힣]/;

const imageItem = (id: string): QabImageItem => ({
  itemId: id,
  category: 'word',
  promptText: 'apple',
  instruction: 'Pick the picture of the word you heard.',
  choices: [
    { choiceId: id + '_ok', label: 'apple', imageUrl: '/a.png', isCorrect: true },
    { choiceId: id + '_n1', label: 'pear', imageUrl: '/b.png', isCorrect: false },
  ],
});

describe('연습 모드 화면 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('맞히면 영어 정답 문구, 받침 접미는 붙지 않는다', async () => {
    const deps: UsePracticeDeps = {
      practiceApi: { submitResults: () => Promise.resolve({ saved: 0 }) },
      pickWordItems: (() => [imageItem('img_0')]) as UsePracticeDeps['pickWordItems'],
      pickSpellItems: (() => []) as UsePracticeDeps['pickSpellItems'],
      generateSessionToken: () => 'tok-1',
      imageChoiceCount: 1,
      wordChoiceCount: 0,
      oddOneOutCount: 0,
      spellCount: 0,
    };
    const { container } = render(<PracticeScreen onExit={() => {}} deps={deps} />);
    // 선택지 그림 로딩 실패(onError)가 렌더 직후 비동기로 떨어진다(jsdom).
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByLabelText('Choose apple'));

    expect(screen.getByRole('status')).toHaveTextContent("That's right, it's 'apple'.");
    expect(screen.getByLabelText('Finish practice')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
