// shared/components 아래 공용 컴포넌트를 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 ItemProgressBar의 aria-label,
// LoadingOverlay의 기본 문구가 영어로 나오고 한글이 새지 않는다.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../i18n/i18n.js';
import { DEFAULT_LOCALE } from '../domain/locale.js';
import { ItemProgressBar } from './ItemProgressBar.js';
import { LoadingOverlay } from './LoadingOverlay.js';

const HANGUL = /[가-힣]/;

describe('shared/components — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('ItemProgressBar — aria-label이 영어', () => {
    render(<ItemProgressBar current={3} total={5} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-label',
      'Progress 3 / 5',
    );
  });

  it('LoadingOverlay — message 미지정 시 기본 문구가 영어', () => {
    const { container } = render(<LoadingOverlay />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('LoadingOverlay — message 지정 시 그대로 쓴다', () => {
    render(<LoadingOverlay message="Custom message" />);
    expect(screen.getByText('Custom message')).toBeInTheDocument();
  });
});
