// 환자 등록 화면을 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 라벨·placeholder·버튼·에러 문구가
// 영어로 나오고 한글이 새지 않는다.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { i18n } from '../i18n/i18n.js';
import { DEFAULT_LOCALE } from '../domain/locale.js';
import { SessionProvider } from './SessionContext.js';
import { PatientSetupScreen } from './PatientSetupScreen.js';

const HANGUL = /[가-힣]/;

describe('환자 등록 화면 — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('라벨·placeholder·버튼이 영어', () => {
    const { container } = render(
      <SessionProvider>
        <PatientSetupScreen />
      </SessionProvider>,
    );
    expect(screen.getByText('Patient ID')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('e.g. P-2026-001'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start assessment' }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('빈 값 제출 시 에러 문구가 영어', () => {
    render(
      <SessionProvider>
        <PatientSetupScreen />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start assessment' }));
    expect(
      screen.getByText('Please enter the patient ID.'),
    ).toBeInTheDocument();
  });
});
