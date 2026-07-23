import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryListScreen } from './EntryListScreen.js';
import type { MemoryEntry } from '../domain/MemoryEntry.js';
import type { UseMemoryEntriesReturn } from '../application/useMemoryEntries.js';

/**
 * 대화 준비 상태 안내 회귀 테스트.
 *
 * 배경: 보호자가 일기를 써도 환자의 대화 기능이 열리지 않았다. 목표 단어 등록과
 * 시나리오 생성이라는 두 단계가 더 필요한데 아무도 알려주지 않았다.
 *
 * 그래서 교착이 생겼다 — 보호자 카드는 '분석 완료'(초록)를 띄워 다 끝난 것처럼
 * 보였고, 환자 화면은 '보호자가 준비 중이에요'를 띄워 보호자를 가리켰다.
 * 양쪽이 서로를 기다렸다.
 *
 * 이 테스트가 고정하는 것: 카드는 **완료 표시가 아니라 다음에 할 일**을 보여준다.
 */
describe('EntryListScreen — 대화 준비 상태', () => {
  // 이 안내는 대화 기능이 켜져 있을 때만 의미가 있다.
  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_CONVERSATION', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
    return {
      id: 'entry-1',
      patientId: 'patient-1',
      photoUrl: null,
      locationTag: '해운대',
      objectTags: null,
      emotionTag: null,
      targetWords: [],
      hasScenario: false,
      hasMaskedContext: true,
      createdAt: '2026-07-20T00:00:00.000Z',
      ...overrides,
    };
  }

  function renderWith(entries: MemoryEntry[]) {
    const memoryEntries = {
      entries,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    } as unknown as UseMemoryEntriesReturn;

    render(
      <EntryListScreen memoryEntries={memoryEntries} onSelectEntry={vi.fn()} />,
    );
  }

  it('목표 단어가 없으면 그것부터 하라고 말한다', () => {
    renderWith([makeEntry({ targetWords: [], hasMaskedContext: true })]);

    expect(screen.getByText(/목표 단어를 등록해 주세요/)).toBeTruthy();
  });

  it('목표 단어만 있으면 다음은 시나리오 생성이라고 말한다', () => {
    renderWith([
      makeEntry({ targetWords: ['바다'], hasMaskedContext: true }),
    ]);

    expect(screen.getByText(/시나리오를 생성해 주세요/)).toBeTruthy();
  });

  it('준비가 끝나면 대화 가능함을 알린다', () => {
    renderWith([
      makeEntry({ targetWords: ['바다'], hasScenario: true }),
    ]);

    expect(screen.getByText('대화 준비 완료')).toBeTruthy();
  });

  it('분석 중일 때는 보호자를 재촉하지 않는다', () => {
    // 이 단계는 서버가 하는 일이라 보호자가 할 수 있는 게 없다.
    // 여기서 "목표 단어를 등록하세요"라고 하면 헛수고를 시킨다.
    renderWith([makeEntry({ hasMaskedContext: false })]);

    expect(screen.getByText('분석 중')).toBeTruthy();
    expect(screen.queryByText(/등록해 주세요/)).toBeNull();
  });

  it('대화 기능이 꺼져 있으면 준비 안내를 하지 않는다', () => {
    // 시나리오는 대화 전용이다. 환자가 쓸 수 없는 기능을 두고
    // "대화하려면 …해 주세요"라고 하면 보호자에게 헛수고를 시킨다.
    vi.stubEnv('VITE_ENABLE_CONVERSATION', '');

    renderWith([makeEntry({ targetWords: [], hasMaskedContext: true })]);

    expect(screen.queryByText(/대화하려면/)).toBeNull();
    expect(screen.queryByText('분석 중')).toBeNull();
    expect(screen.queryByText('대화 준비 완료')).toBeNull();
  });

  it('준비가 안 끝났는데 완료처럼 보이는 표시를 쓰지 않는다', () => {
    // 이것이 원래 버그의 핵심이다. '분석 완료'라는 초록 배지가 떠서
    // 보호자가 다 끝났다고 판단했다.
    renderWith([makeEntry({ targetWords: [], hasMaskedContext: true })]);

    expect(screen.queryByText('분석 완료')).toBeNull();
    expect(screen.queryByText('대화 준비 완료')).toBeNull();
  });
});
