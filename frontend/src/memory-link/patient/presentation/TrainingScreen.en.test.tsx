// TrainingScreen을 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.
//
// TrainingScreen은 이 저장소에서 원래 테스트가 없던 화면이다(훈련 세션은
// useTrainingSession이 실제 API를 부르고, 컴포넌트가 deps 주입을 받지 않는다).
// 그 훅과 STT 서비스를 모킹해 로딩·오류 두 상태만 확인한다 — 전체 대화 흐름
// 테스트는 이 PR의 범위(문자열 추출)를 넘는 별도 과제다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { TrainingScreen } from './TrainingScreen.js';

const HANGUL = /[가-힣]/;

const useTrainingSessionMock = vi.hoisted(() => vi.fn());
vi.mock('../application/useTrainingSession.js', () => ({
  useTrainingSession: useTrainingSessionMock,
}));

const BASE = {
  session: null,
  messages: [],
  isSpeaking: false,
  hintLevel: 0,
  startSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn(),
  requestHint: vi.fn(),
  completeSession: vi.fn(),
};

describe('TrainingScreen — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('로딩 상태 — 영어 문구', () => {
    useTrainingSessionMock.mockReturnValue({ ...BASE, isLoading: true, error: null });
    const { container } = render(
      <TrainingScreen memoryEntryId="m1" targetWord="사과" onComplete={() => {}} />,
    );
    expect(screen.getByText('Getting your training ready…')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('세션 시작 실패 — 영어 오류 문구와 돌아가기', () => {
    useTrainingSessionMock.mockReturnValue({
      ...BASE,
      isLoading: false,
      error: 'network error',
    });
    const { container } = render(
      <TrainingScreen memoryEntryId="m1" targetWord="사과" onComplete={() => {}} />,
    );
    expect(screen.getByText("We couldn't start training.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
