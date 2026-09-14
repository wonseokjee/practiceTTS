// 환자 대시보드 화면 배치 A를 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트:
//  - 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다(폴백 끔, §7-7 결정 A)
//  - Trans로 옮긴 강조 문구(소리 확인 재시도 안내)도 영어로 나온다
//
// StreakRow는 제외했다 — 요일 라벨·오늘 aria는 domain/streak.ts가 만드는데,
// 그건 요일 이름·주 시작(계획서 0-5) 재구현 과제라 이 배치의 범위가 아니다.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { SoundCheckScreen } from './SoundCheckScreen.js';
import { SoloDailyHome } from './SoloDailyHome.js';
import { WeekReviewScreen } from './WeekReviewScreen.js';

const HANGUL = /[가-힣]/;

const ttsSpeak = vi.hoisted(() => vi.fn());
vi.mock('../../../shared/infrastructure/ttsFactory.js', () => ({
  createTtsService: () => ({ speak: ttsSpeak, cancel: vi.fn() }),
}));

describe('환자 대시보드 화면(배치 A) — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });
  beforeEach(() => {
    ttsSpeak.mockReset();
  });

  it('소리 확인 — 재생 실패 안내도, 재시도 안내(Trans 강조 포함)도 영어', async () => {
    ttsSpeak.mockRejectedValue(new Error('음소거'));
    const { container } = render(
      <SoundCheckScreen
        destination="assessment"
        onPass={() => {}}
        onSkip={() => {}}
        onCancel={() => {}}
      />,
    );
    await screen.findByRole('alert');
    expect(
      screen.getByText(/The assessment has questions you'll listen to./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This device couldn't play any sound./),
    ).toBeInTheDocument();
    // Trans로 나눈 재시도 안내 — <b>Play sound</b>를 포함한 문장이 한 덩어리로 읽혀야 한다.
    expect(
      screen.getByText((_, node) =>
        node?.textContent === 'Then press Play sound above one more time.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start without sound' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('솔로 홈 — 인사·CTA·부차 링크가 영어', () => {
    const { container } = render(
      <SoloDailyHome
        streakDays={[]}
        hasResumable
        onStart={() => {}}
        onReview={() => {}}
        onPractice={() => {}}
      />,
    );
    expect(screen.getByText('Good to see you today.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "Start today's practice" }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pick up where you left off')).toBeInTheDocument();
    expect(screen.getByText('Look back on this week')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('돌아보기 — 빈 상태 문구가 영어', async () => {
    const { container } = render(
      <WeekReviewScreen onBack={() => {}} loadItems={() => Promise.resolve([])} />,
    );
    expect(
      await screen.findByText('No memories from recent practice yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("They'll show up here once you practice today."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
