// 검사 허브 화면을 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../i18n/i18n.js';
import { DEFAULT_LOCALE } from '../domain/locale.js';
import { AssessmentCard } from './AssessmentCard.js';
import { AssessmentHubScreen } from './AssessmentHubScreen.js';

vi.mock('../session/SessionContext.js', () => ({
  useSessionContext: () => ({
    session: { sessionId: 'test-session', patientId: 'P001' },
    endSession: vi.fn(),
  }),
}));

const HANGUL = /[가-힣]/;

describe('검사 허브 화면 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('AssessmentCard — 미완료·완료 상태 문구가 영어', () => {
    const { container, rerender } = render(
      <AssessmentCard
        title="Sentence comprehension"
        subtitle="QAB subtest 4"
        description="Practices understanding of complex sentence structures"
        isCompleted={false}
        onStart={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    rerender(
      <AssessmentCard
        title="Sentence comprehension"
        subtitle="QAB subtest 4"
        description="Practices understanding of complex sentence structures"
        isCompleted={true}
        onStart={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('AssessmentHubScreen — 헤더·카드·완료 메시지가 영어', () => {
    const { container } = render(
      <AssessmentHubScreen
        completedAssessments={{ sentComp: true, wordComp: true }}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('Select an activity')).toBeInTheDocument();
    expect(screen.getByText('Level of consciousness (LOC)')).toBeInTheDocument();
    expect(screen.getByText('QAB subtest 1')).toBeInTheDocument();
    expect(screen.getByText('Sentence comprehension')).toBeInTheDocument();
    expect(screen.getByText('QAB subtest 4')).toBeInTheDocument();
    expect(screen.getByText('Word comprehension')).toBeInTheDocument();
    expect(screen.getByText('QAB subtest 3')).toBeInTheDocument();
    expect(screen.getByText('All activities are complete.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
