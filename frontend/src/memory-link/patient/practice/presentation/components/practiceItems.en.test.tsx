// 연습 화면 하위 아이템 렌더러(무리에서 빼기·낱말 고르기)를 영어로 그린다
// (영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 group aria-label과 선택지 버튼
// aria-label이 영어로 나오고 한글이 새지 않는다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../../shared/domain/locale.js';
import { OddOneOutItem } from './OddOneOutItem.js';
import { WordChoiceItem } from './WordChoiceItem.js';
import type { PracticeOddOneOutItem } from '../../domain/practiceOddOneOut.js';
import type { PracticeWordChoiceItem } from '../../domain/practiceWordChoice.js';

const HANGUL = /[가-힣]/;

const oddOneOutItem = (): PracticeOddOneOutItem => ({
  itemId: 'ooo_001',
  choices: [
    { choiceId: 'c1', label: 'apple', imageUrl: '/apple.svg', isCorrect: false },
    { choiceId: 'c2', label: 'car', imageUrl: '/car.svg', isCorrect: true },
  ],
});

const wordChoiceItem = (): PracticeWordChoiceItem => ({
  itemId: 'wc_001',
  imageUrl: '/apple.svg',
  choices: [
    { choiceId: 'c1', label: 'pear', isCorrect: false },
    { choiceId: 'c2', label: 'apple', isCorrect: true },
  ],
});

describe('practice item 렌더러 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('OddOneOutItem — group aria-label과 선택지 aria-label이 영어', () => {
    const { container } = render(
      <OddOneOutItem
        item={oddOneOutItem()}
        isSelectable
        showAnswer={false}
        selectedChoiceId={null}
        onSelect={vi.fn()}
      />,
    );
    // 지시문은 문항 데이터가 아니라 i18n에서 온다 — 예전엔 도메인 상수(한국어)라
    // 영어 화면에도 "종류가 다른 하나를 골라주세요"가 떴다.
    expect(screen.getByText('Pick the one from a different group')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Image choices' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose apple')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('WordChoiceItem — group aria-label과 선택지 aria-label이 영어', () => {
    const { container } = render(
      <WordChoiceItem
        item={wordChoiceItem()}
        isSelectable
        showAnswer={false}
        selectedChoiceId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Pick the word for the picture')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Word choices' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose apple')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
