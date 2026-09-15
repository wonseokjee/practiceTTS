// 보호자 화면 배치 B(연결된 계정·기억 목록·음성 데이터 제공·캡처 화면 가드)를
// 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.
//
// CaregiverDashboard·EntryDetailScreen(→시나리오)·useCaptureFlow 등 무거운
// 의존성이 얽힌 화면은 이번 배치의 렌더 테스트 범위 밖이다 — CaptureScreen은
// patientId 없음(가드 상태)만, 나머지 두 상태(진행 중·완료)는 대시보드와 함께
// 별도로 다룬다.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import type { MemoryEntry } from '../domain/MemoryEntry.js';
import type { UseMemoryEntriesReturn } from '../application/useMemoryEntries.js';

const HANGUL = /[가-힣]/;

let mockUser: { linkedProviders: string[] } | null = { linkedProviders: ['kakao'] };
const refreshUser = vi.fn();
vi.mock('../../shared/AuthContext.js', () => ({
  useAuth: () => ({ user: mockUser, refreshUser }),
}));

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('../../shared/MemoryLinkApi.js', () => ({
  API_BASE_URL: 'http://api.test',
  memoryLinkApi: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

import { AccountLinkScreen } from './AccountLinkScreen.js';
import { EntryListScreen } from './EntryListScreen.js';
import { SpeechConsentScreen } from './SpeechConsentScreen.js';
import { CaptureScreen } from './CaptureScreen.js';

function makeEntry(over: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'e1',
    patientId: 'p1',
    photoUrl: null,
    locationTag: null,
    objectTags: null,
    emotionTag: null,
    targetWords: [],
    hasScenario: false,
    hasMaskedContext: false,
    patientNotes: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function makeMemoryEntries(
  over: Partial<UseMemoryEntriesReturn> = {},
): UseMemoryEntriesReturn {
  return {
    entries: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    triggerScenario: vi.fn(),
    scenarioStatus: {},
    scenarioNotice: {},
    ...over,
  };
}

describe('보호자 화면 배치 B — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });
  beforeEach(() => {
    mockUser = { linkedProviders: ['kakao'] };
    refreshUser.mockReset();
    get.mockReset();
    put.mockReset();
    post.mockReset();
    del.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('연결된 계정 — 제목·상태·버튼이 영어', () => {
    const { container } = render(<AccountLinkScreen onBack={() => {}} />);
    expect(screen.getByText('Connected accounts')).toBeInTheDocument();
    expect(screen.getByText('Kakao')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('기억 목록 — 빈 상태 안내가 영어', () => {
    const { container } = render(
      <EntryListScreen
        memoryEntries={makeMemoryEntries()}
        onSelectEntry={() => {}}
      />,
    );
    expect(screen.getByText('Memories')).toBeInTheDocument();
    expect(screen.getByText('No memories yet')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('기억 목록 — 대화 준비 배지가 영어', () => {
    vi.stubEnv('VITE_ENABLE_CONVERSATION', 'true');
    render(
      <EntryListScreen
        memoryEntries={makeMemoryEntries({
          entries: [makeEntry({ hasScenario: true })],
        })}
        onSelectEntry={() => {}}
      />,
    );
    expect(screen.getByText('Ready to talk')).toBeInTheDocument();
  });

  it('음성 데이터 제공 — 제목·안내가 영어', async () => {
    get.mockResolvedValue({ data: { consent: false, consentAt: null, count: 0 } });
    const { container } = render(<SpeechConsentScreen onBack={() => {}} />);
    expect(await screen.findByText('Voice data sharing')).toBeInTheDocument();
    expect(screen.getByText('Not saving right now')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });

  it('음성 데이터 제공 — 저장 건수·삭제 확인이 영어', async () => {
    get.mockResolvedValue({ data: { consent: true, consentAt: null, count: 2 } });
    render(<SpeechConsentScreen onBack={() => {}} />);
    expect(await screen.findByText('2 stored')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete all'));
    expect(
      screen.getByText("Delete all 2 saved recordings? This can't be undone."),
    ).toBeInTheDocument();
  });

  it('캡처 화면 — 환자 미연결 가드가 영어', () => {
    const { container } = render(
      <CaptureScreen
        patientId=""
        flow={{} as never}
        onComplete={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText('No patient is connected. Please ask an admin to connect one.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(HANGUL);
  });
});
