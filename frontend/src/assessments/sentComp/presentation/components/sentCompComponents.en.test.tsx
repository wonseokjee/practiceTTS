// 문장 이해(SentComp) 검사 컴포넌트를 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import { ChoiceImageCard } from './ChoiceImageCard.js';
import { ImageChoiceGrid } from './ImageChoiceGrid.js';
import { ScoreResultPanel } from './ScoreResultPanel.js';
import { SentenceAudioPlayer } from './SentenceAudioPlayer.js';
import type { ChoiceImage } from '../../domain/types.js';
import type { ScoreDTO } from '../../application/dtos.js';

const HANGUL = /[가-힣]/;

const choiceA: ChoiceImage = {
  imageUrl: '/a.png',
  altText: 'a dog chasing a cat',
  isCorrect: true,
};
const choiceB: ChoiceImage = {
  imageUrl: '/b.png',
  altText: 'a cat chasing a dog',
  isCorrect: false,
};

function score(): ScoreDTO {
  return {
    totalScore: 80,
    correctCount: 8,
    totalItems: 10,
    byType: {
      reversible: { total: 4, correct: 4, rate: 1 },
      'relative-clause': { total: 4, correct: 3, rate: 0.75 },
      'embedded-clause': { total: 0, correct: 0, rate: null },
    },
    averageReactionTimeMs: 1234,
    averageReplayCount: 1.5,
  };
}

describe('문장 이해 검사 컴포넌트 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('ChoiceImageCard — 선택지 aria가 영어', () => {
    const { container } = render(
      <ChoiceImageCard
        choice={choiceA}
        index={0}
        isSelected={false}
        isSelectable={true}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Choice 1: a dog chasing a cat' }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('ImageChoiceGrid — 그룹 aria가 영어', () => {
    render(
      <ImageChoiceGrid
        choices={[choiceA, choiceB]}
        isSelectable={true}
        selectedIndex={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('group', { name: 'Image choices' })).toBeInTheDocument();
  });

  it('SentenceAudioPlayer — 상태 문구·버튼이 영어', () => {
    const { container, rerender } = render(
      <SentenceAudioPlayer
        sentence="The dog is chasing the cat."
        isPlaying={true}
        isReplayEnabled={false}
        onReplay={() => {}}
      />,
    );
    expect(screen.getByText('Playing...')).toBeInTheDocument();
    rerender(
      <SentenceAudioPlayer
        sentence="The dog is chasing the cat."
        isPlaying={false}
        isReplayEnabled={true}
        onReplay={() => {}}
      />,
    );
    expect(screen.getByText('Playback done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay the sentence' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('ScoreResultPanel — 제목·유형 라벨·버튼이 영어', () => {
    const { container } = render(
      <ScoreResultPanel score={score()} onProceed={() => {}} />,
    );
    expect(screen.getByText('Assessment complete')).toBeInTheDocument();
    expect(screen.getByText('Reversible (word order)')).toBeInTheDocument();
    expect(screen.getByText('Relative clause')).toBeInTheDocument();
    expect(screen.getByText('Embedded clause')).toBeInTheDocument();
    expect(screen.getByText('8 / 10 correct')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to next assessment' }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
