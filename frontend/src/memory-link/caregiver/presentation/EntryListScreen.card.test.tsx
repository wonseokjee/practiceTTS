// 목록 카드가 **기억을 보여주는가** — DR13.
//
// 예전에는 사진이 없으면 회색 상자에 📷를 그렸다. 기억은 사진 아니면 글 중
// 하나가 반드시 있으므로(백엔드가 강제한다) 그 상자는 "빠진 것이 있다"는
// 거짓 신호였다. 게다가 응답에 이미 들어 있던 글(`patientNotes`)을 카드가
// 안 쓰고 있었다 — 보여줄 게 없어서가 아니라 손에 든 것을 안 쓴 것이다.
//
// 상자만 지우면 사진 없는 카드가 날짜만 남는다. 그래서 두 가지를 함께 지킨다.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EntryListScreen } from './EntryListScreen.js';
import type { MemoryEntry } from '../domain/MemoryEntry.js';
import type { UseMemoryEntriesReturn } from '../application/useMemoryEntries.js';

vi.mock('../../shared/AuthedImage.js', () => ({
  AuthedImage: (props: { src: string; alt: string }) => (
    <img src={props.src} alt={props.alt} />
  ),
}));

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'entry-1',
    patientId: 'patient-1',
    photoUrl: null,
    locationTag: null,
    objectTags: null,
    emotionTag: null,
    targetWords: [],
    patientNotes: [
      { category: 'moment', answerText: '막국수집에서 국수를 먹었어요', orderIndex: 0 },
      { category: 'activity', answerText: '산책', orderIndex: 1 },
    ],
    hasScenario: false,
    hasMaskedContext: true,
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function renderList(entries: MemoryEntry[]) {
  const memoryEntries = {
    entries,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  } as unknown as UseMemoryEntriesReturn;

  return render(
    <EntryListScreen memoryEntries={memoryEntries} onSelectEntry={vi.fn()} />,
  );
}

describe('EntryListScreen 카드', () => {
  it('사진이 없으면 그 자리에 아무것도 그리지 않는다', () => {
    const { container } = renderList([makeEntry({ photoUrl: null })]);
    expect(container.querySelector('img')).toBeNull();
  });

  it('사진이 없어도 그날의 기억이 보인다', () => {
    renderList([makeEntry({ photoUrl: null })]);
    expect(screen.getByText('막국수집에서 국수를 먹었어요')).toBeTruthy();
  });

  it('사진이 있으면 사진과 기억을 함께 보여준다', () => {
    renderList([makeEntry({ photoUrl: '/p.jpg' })]);
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByText('막국수집에서 국수를 먹었어요')).toBeTruthy();
  });

  it('본문으로 쓰는 것은 moment 하나다 — 태그를 본문에 섞지 않는다', () => {
    renderList([makeEntry()]);
    expect(screen.queryByText('산책')).toBeNull();
  });

  it('moment가 없어도 터지지 않는다', () => {
    // 백엔드는 항상 배열을 주지만 빈 배열은 올 수 있다.
    renderList([makeEntry({ patientNotes: [] })]);
    expect(screen.getByText(/2026/)).toBeTruthy();
  });

  it('날짜는 화면 로케일(지금 한국어)로 적는다 — formatDate를 거친다', () => {
    // 달 단위까지만 본다 — 7/20 00:00Z는 어느 타임존에서도 7월이다.
    // 영어로 새면 "July 20, 2026"이 되어 여기서 깨진다.
    renderList([makeEntry()]);
    expect(screen.getByText(/2026년 7월/)).toBeTruthy();
  });
});
