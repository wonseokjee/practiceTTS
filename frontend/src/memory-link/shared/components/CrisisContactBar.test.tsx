// CrisisContactBar — 일기 '나의 하루'와 선배 보호자 도우미 하단의 위기 연결처 줄.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import {
  ALL_CRISIS_CONTACT_IDS,
  crisisContactsFor,
} from '../crisisContacts.js';
import { CrisisContactBar } from './CrisisContactBar.js';

const HANGUL = /[가-힣]/;

function mockPointer(coarse: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      matches: coarse && q === '(pointer: coarse)',
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(async () => {
  // 언어를 되돌리기 전에 떼어 낸다 — 붙은 채로 바꾸면 act 밖 재렌더가 난다
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage(DEFAULT_LOCALE);
});

describe('CrisisContactBar', () => {
  it('한국어: 109·119를 tel 링크로 바로 보여준다', () => {
    render(<CrisisContactBar />);
    const bar = screen.getByRole('complementary', { name: '위기 연결처' });
    const links = within(bar).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'tel:109',
      'tel:119',
    ]);
    expect(
      within(bar).getByText('지금 많이 힘들면 바로 전화하세요'),
    ).toBeInTheDocument();
  });

  it('더보기 시트에 112·노인학대 신고까지 전체 목록이 있고, Esc로 닫히며 포커스가 돌아온다', () => {
    render(<CrisisContactBar />);
    const more = screen.getByRole('button', { name: '연결처 더보기' });
    fireEvent.click(more);

    const sheet = screen.getByRole('dialog', {
      name: '바로 이야기할 수 있는 곳',
    });
    const hrefs = within(sheet)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['tel:109', 'tel:112', 'tel:119', 'tel:15771389']);
    expect(document.activeElement).toBe(
      within(sheet).getByRole('heading', { name: '바로 이야기할 수 있는 곳' }),
    );

    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(more);
  });

  it('영어: 미국 번호(988·911)를 보여주고 한글이 섞이지 않는다', async () => {
    await i18n.changeLanguage('en-US');
    render(<CrisisContactBar />);
    const bar = screen.getByRole('complementary', { name: 'Crisis contacts' });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['tel:988', 'tel:911']);
    expect(bar.textContent).not.toMatch(HANGUL);
    expect(
      within(bar).getByRole('link', {
        name: /988 Suicide and Crisis Lifeline/,
      }),
    ).toBeInTheDocument();
  });

  it('번호를 모르는 로케일은 다른 나라 번호를 대신 띄우지 않는다', () => {
    expect(crisisContactsFor('ja-JP')).toBeNull();
  });

  it('터치 기기에서 글 입력 칸에 포커스가 가면 숨고, 벗어나면 돌아온다', () => {
    mockPointer(true);
    render(
      <>
        <textarea aria-label="답변" />
        <CrisisContactBar />
      </>,
    );
    const textarea = screen.getByLabelText('답변');

    act(() => textarea.focus());
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    act(() => textarea.blur());
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('마우스 기기에서는 입력 중에도 그대로 보인다', () => {
    mockPointer(false);
    render(
      <>
        <textarea aria-label="답변" />
        <CrisisContactBar />
      </>,
    );
    act(() => screen.getByLabelText('답변').focus());
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('모든 연락처 id에 ko·en 이름 문구가 있다', () => {
    for (const locale of ['ko-KR', 'en-US']) {
      const json = JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            'src/shared/i18n/locales',
            locale,
            'caregiver.json',
          ),
          'utf8',
        ),
      ) as { crisisBar: { contact: Record<string, string> } };
      for (const id of ALL_CRISIS_CONTACT_IDS) {
        expect(json.crisisBar.contact[id], `${locale} ${id}`).toBeTruthy();
      }
    }
  });
});
