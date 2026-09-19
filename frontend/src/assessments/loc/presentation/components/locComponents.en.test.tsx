// 의식 수준(LOC) 검사 컴포넌트를 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';
import { LocAudioIndicator } from './LocAudioIndicator.js';
import { LocProgressBar } from './LocProgressBar.js';
import { LocTouchButton } from './LocTouchButton.js';

const HANGUL = /[가-힣]/;

describe('LOC 검사 컴포넌트 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('LocAudioIndicator — 상태 문구가 영어', () => {
    const { container } = render(<LocAudioIndicator isTtsPlaying={true} />);
    expect(screen.getByRole('status', { name: 'Playing voice instructions' })).toBeInTheDocument();
    expect(screen.getByText('Playing voice instructions…')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('LocProgressBar — 남은 시간 aria·단위가 영어', () => {
    const { container } = render(
      <LocProgressBar isActive={true} remainingSeconds={7} />,
    );
    expect(screen.getByRole('timer', { name: '7 seconds remaining' })).toBeInTheDocument();
    expect(screen.getByText('s')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('LocTouchButton — 활성/대기 상태 문구가 영어', () => {
    const { container, rerender } = render(
      <LocTouchButton isSelectable={true} onActivate={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Touch here' })).toBeInTheDocument();
    expect(screen.getByText('Touch after you hear the instructions')).toBeInTheDocument();
    rerender(<LocTouchButton isSelectable={false} onActivate={() => {}} />);
    expect(screen.getByRole('button', { name: 'Wait for the voice instructions' })).toBeInTheDocument();
    expect(screen.getByText('Please wait a moment')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
