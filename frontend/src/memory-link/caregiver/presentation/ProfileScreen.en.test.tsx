// 가족 관계 라벨이 활성 로케일을 따른다(영어판 M1 Exit — 한국어 고정 상수 제거)

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { ProfileScreen } from './ProfileScreen.js';

// 훅이 매 렌더 새 객체를 주면 화면의 동기화 effect가 무한 반복한다 — 참조를 고정한다.
const hookResult = vi.hoisted(() => ({
  profile: {
    patientId: 'p1',
    hometown: null,
    occupation: null,
    hobbies: [] as string[],
    significantPlaces: [] as string[],
    hasNotes: false,
    family: [
      {
        id: 'f1',
        relation: 'son',
        relationLabel: '아들',
        name: 'Minjun',
        gender: 'M',
        relationOrdinal: 1,
        note: null,
      },
    ],
    updatedAt: '2026-09-25T00:00:00.000Z',
  },
  isLoading: false,
  isSaving: false,
  error: null,
  save: () => Promise.resolve(),
}));

vi.mock('../application/usePatientProfile.js', () => ({
  usePatientProfile: () => hookResult,
}));

const HANGUL = /[가-힣]/;

describe('프로필 화면 가족 관계 — 로케일을 따른다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('en-US: 관계 선택지와 등록된 가족 라벨이 영어이고 한글이 없다', () => {
    const { container } = render(<ProfileScreen embedded />);
    expect(
      screen.getByRole('option', { name: 'Granddaughter' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('listitem')).getByText('Son'),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('ko-KR: 한국어 라벨 그대로', async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
    render(<ProfileScreen embedded />);
    expect(screen.getByRole('option', { name: '손녀' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('listitem')).getByText('아들'),
    ).toBeInTheDocument();
  });
});
