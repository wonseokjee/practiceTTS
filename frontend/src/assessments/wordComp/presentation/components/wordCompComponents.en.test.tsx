// 단어 이해(WordComp) 검사 컴포넌트를 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import { AudioPlayerBar } from './AudioPlayerBar.js';
import { ImageChoiceCard } from './ImageChoiceCard.js';
import { ImageChoiceGrid } from './ImageChoiceGrid.js';
import { SessionSummaryView } from './SessionSummaryView.js';
import type { WordComprehensionChoiceDTO } from '../../application/dtos/WordComprehensionChoiceDTO.js';
import type { SessionSummaryDTO } from '../../application/dtos/SessionSummaryDTO.js';

const HANGUL = /[가-힣]/;

const choice: WordComprehensionChoiceDTO = {
  choiceId: 'c1',
  word: 'apple',
  imageUrl: '/a.png',
};

function summary(): SessionSummaryDTO {
  return {
    totalScore: 7,
    percentageScore: 70,
    totalItems: 10,
    distractorPattern: {
      semanticErrorCount: 2,
      phonemicErrorCount: 1,
      unrelatedErrorCount: 0,
      semanticErrorRate: 0.67,
      phonemicErrorRate: 0.33,
      unrelatedErrorRate: 0,
    },
    averageReactionTimeMs: 2200,
    averageReplayCount: 1.2,
  };
}

describe('단어 이해 검사 컴포넌트 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('AudioPlayerBar — 상태 문구·재청취 버튼이 영어', () => {
    const { container, rerender } = render(
      <AudioPlayerBar
        targetWord="apple"
        isPlaying={true}
        isReplayEnabled={false}
        replayCount={0}
        onReplay={() => {}}
      />,
    );
    expect(screen.getByText('Playing audio…')).toBeInTheDocument();
    expect(
      screen.getByText('Listen to the word and choose the picture'),
    ).toBeInTheDocument();
    rerender(
      <AudioPlayerBar
        targetWord="apple"
        isPlaying={false}
        isReplayEnabled={true}
        replayCount={2}
        onReplay={() => {}}
      />,
    );
    expect(screen.getByText('Audio playback done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toHaveTextContent(
      'Replay (2)',
    );
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('ImageChoiceCard·ImageChoiceGrid — aria가 영어', () => {
    render(
      <ImageChoiceGrid choices={[choice]} isSelectable={true} onSelect={() => {}} />,
    );
    expect(screen.getByRole('group', { name: 'Image choices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose apple' })).toBeInTheDocument();
  });

  it('ImageChoiceCard 단독 렌더 — aria가 영어', () => {
    render(
      <ImageChoiceCard choice={choice} isSelectable={true} onSelect={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Choose apple' })).toBeInTheDocument();
  });

  it('SessionSummaryView — 결과·오답 패턴·통계·버튼이 영어', () => {
    const { container } = render(
      <SessionSummaryView summary={summary()} onProceed={() => {}} />,
    );
    expect(screen.getByText('Word comprehension result')).toBeInTheDocument();
    expect(screen.getByText('/ 10 pts')).toBeInTheDocument();
    expect(screen.getByText('Error pattern analysis (3 incorrect)')).toBeInTheDocument();
    expect(screen.getByText('Semantic error')).toBeInTheDocument();
    expect(screen.getByText('Phonemic error')).toBeInTheDocument();
    expect(screen.getByText('Unrelated error')).toBeInTheDocument();
    expect(screen.getByText('Reaction stats')).toBeInTheDocument();
    expect(screen.getByText('Average reaction time')).toBeInTheDocument();
    expect(screen.getByText('Average replay count')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to next activity' }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
