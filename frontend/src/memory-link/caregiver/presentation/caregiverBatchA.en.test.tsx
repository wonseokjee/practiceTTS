// 보호자 화면 배치 A(무드체크·나의하루·스킬눈높이·완료율·설정 메뉴)를 영어로
// 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.
//
// SkillLevelCard·SettingsScreen(설정 카드 라벨)은 subtestLabel()이 여전히
// 한국어를 낸다(용어 매핑 레이어 1-3, 아직 별도 과제) — 이 컴포넌트들의
// 껍데기 문구만 영어인지 확인하고, 검사 이름 자체는 한글 검사에서 뺀다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { MOOD_VISUAL_TOKENS } from '../domain/CaptureFlow.js';
import { MoodCheckStep } from './MoodCheckStep.js';
import { MyDayStep } from './MyDayStep.js';
import { SkillLevelCard } from './SkillLevelCard.js';
import { SessionCompletionCard } from './SessionCompletionCard.js';

const logout = vi.fn();
vi.mock('../../shared/AuthContext.js', () => ({
  useAuth: () => ({ logout }),
}));

import { SettingsScreen } from './SettingsScreen.js';

const HANGUL = /[가-힣]/;

describe('보호자 화면 배치 A — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('무드 체크 — 제목·안내·다음 버튼이 영어', () => {
    render(
      <MoodCheckStep mood={null} onSelectMood={() => {}} onNext={() => {}} error={null} />,
    );
    expect(screen.getByText('How were you feeling today?')).toBeInTheDocument();
    expect(screen.getByText('Pick whichever face feels closest.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to next step' }),
    ).toBeInTheDocument();
    // 무드 라벨(MOOD_VISUAL_TOKENS)은 도메인 데이터라 이번 배치 범위 밖 — 한글 그대로다.
    for (const token of MOOD_VISUAL_TOKENS) {
      expect(screen.getByRole('radio', { name: token.ariaLabel })).toBeInTheDocument();
    }
  });

  it('나의 하루 — 제목·안내·버튼이 영어', () => {
    const { container } = render(
      <MyDayStep
        question={null}
        answerText=""
        onChangeAnswerText={() => {}}
        onSkip={() => {}}
        onNext={() => {}}
        onPrev={() => {}}
      />,
    );
    expect(screen.getByText('My Day')).toBeInTheDocument();
    expect(screen.getByText('Only you can see what you write here.')).toBeInTheDocument();
    expect(screen.getByText('Loading a question…')).toBeInTheDocument();
    expect(screen.getByLabelText('My Day answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip this step' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to previous step' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to next step' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('스킬 눈높이 — 제목·안내가 영어(검사 이름 자체는 아직 한국어)', async () => {
    render(
      <SkillLevelCard
        fetchLevels={() =>
          Promise.resolve({
            levels: { word: 4, sentence: 2, naming: 1, repeat: 3, reading: 2, spell: 3, ddk: 5, loc: 2 },
            manifestVersion: 1,
          })
        }
      />,
    );
    await waitFor(() => expect(screen.getByText('Practice level')).toBeInTheDocument());
    expect(
      screen.getByText(/Shows what difficulty each skill is practicing at right now/),
    ).toBeInTheDocument();
    expect(screen.getByText('Level 4')).toBeInTheDocument();
  });

  it('완료율 카드 — 제목·요약·이탈 안내가 영어', async () => {
    const { container } = render(
      <SessionCompletionCard
        fetchStats={() =>
          Promise.resolve({
            started: 10,
            completed: 7,
            completionRate: 70,
            avgItemsBeforeDropoff: 4.3,
          })
        }
      />,
    );
    expect(await screen.findByText('Practice completion')).toBeInTheDocument();
    expect(await screen.findByText('70%')).toBeInTheDocument();
    expect(
      screen.getByText(/Last 30 days · started 10, completed 7/),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, node) =>
        node?.textContent ===
        "Practices stopped partway got to about 4.3 items on average. If it keeps stopping around the same spot, that's usually where it gets hard.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Days practiced.*on the patient home counts any day/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('설정 메뉴 — 카드 제목·로그아웃·안내가 영어', () => {
    render(<SettingsScreen onBack={() => {}} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Patient info')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Voice data sharing')).toBeInTheDocument();
    expect(screen.getByText('Log out')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Back to the list' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Some images:/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Log out'));
    expect(logout).toHaveBeenCalledOnce();
  });
});
