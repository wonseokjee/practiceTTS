// PracticeSummaryCard — 보호자 대시보드의 '가볍게 연습하기' 카드.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import type { PracticeSummary } from '../../patient/practice/infrastructure/PracticeApi.js';
import { PracticeSummaryCard } from './PracticeSummaryCard.js';

const HANGUL = /[가-힣]/;

function summary(over: Partial<PracticeSummary> = {}): PracticeSummary {
  return {
    days: 7,
    sessions: 2,
    items: 18,
    firstTry: { judged: 12, correct: 9, rate: 0.75 },
    byKind: [
      { kind: 'imageChoice', items: 8, judged: 8, correct: 7 },
      { kind: 'oddOneOut', items: 4, judged: 4, correct: 2 },
      { kind: 'repeat', items: 6, judged: 0, correct: 0 },
    ],
    lastPracticedAt: '2026-10-10T12:00:00Z',
    ...over,
  };
}

const fetchOf = (s: PracticeSummary) => () => Promise.resolve(s);

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage(DEFAULT_LOCALE);
});

describe('PracticeSummaryCard', () => {
  it('한 양과 첫 시도 정답률을 보여준다', async () => {
    render(<PracticeSummaryCard fetchSummary={fetchOf(summary())} />);
    const card = await screen.findByRole('region', { name: '가볍게 연습하기 기록' });

    expect(within(card).getByText('최근 7일 · 2번 · 18문항')).toBeInTheDocument();
    expect(within(card).getByText('75%')).toBeInTheDocument();
    expect(within(card).getByText('처음에 바로 맞힌 비율 (9/12)')).toBeInTheDocument();
  });

  it('종류별 줄은 채점한 종류만 — 따라 말하기(판정 없음)는 줄로 나오지 않는다', async () => {
    render(<PracticeSummaryCard fetchSummary={fetchOf(summary())} />);
    const card = await screen.findByRole('region', { name: '가볍게 연습하기 기록' });
    const items = within(card).getAllByRole('listitem');

    expect(items.map((li) => li.textContent)).toEqual([
      '그림 고르기7/8',
      '종류가 다른 것 고르기2/4',
    ]);
  });

  it('검사 점수와 비교할 수 없다는 안내가 늘 붙는다', async () => {
    render(<PracticeSummaryCard fetchSummary={fetchOf(summary())} />);
    expect(await screen.findByText(/검사 점수와는 비교할 수 없어요/)).toBeInTheDocument();
  });

  it('채점한 문항이 없으면 양만 보여주고 0%를 띄우지 않는다', async () => {
    const s = summary({
      firstTry: { judged: 0, correct: 0, rate: null },
      byKind: [{ kind: 'repeat', items: 6, judged: 0, correct: 0 }],
      items: 6,
    });
    render(<PracticeSummaryCard fetchSummary={fetchOf(s)} />);
    const card = await screen.findByRole('region', { name: '가볍게 연습하기 기록' });

    expect(within(card).getByText('최근 7일 · 2번 · 6문항')).toBeInTheDocument();
    expect(within(card).queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('연습 기록이 없으면 카드를 숨긴다', async () => {
    const s = summary({ items: 0, sessions: 0, byKind: [], firstTry: { judged: 0, correct: 0, rate: null } });
    const { container } = render(<PracticeSummaryCard fetchSummary={fetchOf(s)} />);
    await Promise.resolve();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('불러오기에 실패하면 카드를 숨긴다', async () => {
    const { container } = render(
      <PracticeSummaryCard fetchSummary={() => Promise.reject(new Error('down'))} />,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('영어: 한글이 섞이지 않는다', async () => {
    await i18n.changeLanguage('en-US');
    render(<PracticeSummaryCard fetchSummary={fetchOf(summary())} />);
    const card = await screen.findByRole('region', { name: 'Light practice record' });
    expect(card.textContent).not.toMatch(HANGUL);
  });
});
