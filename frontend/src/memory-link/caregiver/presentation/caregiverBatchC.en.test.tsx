// 보호자 화면 배치 C(하루 기록·프로필·QAB 진행률·주차 기록·기억 상세)를
// 영어로 그린다(영어판 Phase 1-2)
//
// 검증 포인트: 활성 로케일이 en-US면 영어 문구가 나오고 한글이 새지 않는다.
//
// QabProgressCard·WeeklyReportScreen의 subtestLabel()도 용어 매핑
// 레이어(1-3)가 끝나 영어 웰니스 어휘를 낸다(예: 단어 이해 → Word
// activity) — 직역이 아니라 FTC 가드레일에 따른 소비자용 표현이다.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { PatientDayStep } from './PatientDayStep.js';
import { QabProgressCard } from './QabProgressCard.js';
import type { QabSubtestSummary } from '../../patient/quiz/domain/QabResult.js';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type { QabTrendSeries } from '../../patient/quiz/domain/QabResult.js';

vi.mock('../../shared/AuthContext.js', () => ({
  useAuth: () => ({ user: { patientDisplayName: 'Jane' } }),
}));

const get = vi.fn();
const put = vi.fn();
vi.mock('../infrastructure/PatientProfileApi.js', () => ({
  patientProfileApi: {
    get: (...args: unknown[]) => get(...args),
    upsert: (...args: unknown[]) => put(...args),
  },
}));

const getById = vi.fn();
vi.mock('../infrastructure/MemoryEntryApi.js', () => ({
  memoryEntryApi: {
    getById: (...args: unknown[]) => getById(...args),
  },
}));

import { ProfileScreen } from './ProfileScreen.js';
import { EntryDetailScreen } from './EntryDetailScreen.js';
import { WeeklyReportScreen } from './WeeklyReportScreen.js';

function summary(overrides?: Partial<QabSubtestSummary>): QabSubtestSummary {
  return {
    subtest: 'word',
    total: 4,
    correct: 3,
    accuracy: 75,
    assisted: 0,
    unscored: 0,
    avgMetric: null,
    maxMetric: null,
    avgScore: null,
    lastAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('보호자 화면 배치 C — 영어로 그린다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    getById.mockReset();
  });

  it('환자분의 하루 — 제목·안내·저장 힌트·카테고리 이름이 영어', () => {
    render(
      <PatientDayStep
        patientAnswers={{ activity: '', moment: '', context: '' }}
        patientQuestions={{ activity: null, moment: null, context: null }}
        photo={null}
        photoPreview={null}
        isSubmitting={false}
        error={null}
        caregiverWishMessage=""
        onChangeWishMessage={() => {}}
        onChangePatientAnswer={() => {}}
        onSelectPhoto={() => {}}
        onClearPhoto={() => {}}
        onPrev={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("Your loved one's day")).toBeInTheDocument();
    expect(
      screen.getByText("Let's record this together for tomorrow's questions."),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You need at least one answer or one photo to save.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Save today's entry" })).toBeDisabled();
    // 카테고리 이름(CaptureFlow.ts, 프론트 .ts 파일 과제)도 이 배치로 영어가 됐다.
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Moment')).toBeInTheDocument();
    expect(screen.getByText('People, place, or food')).toBeInTheDocument();
  });

  it('QAB 진행률 카드 — 제목·안내·검사 이름(웰니스 어휘)이 영어', async () => {
    const fetchSummary = vi.fn().mockResolvedValue([summary({ assisted: 2 })]);
    render(<QabProgressCard fetchSummary={fetchSummary} />);
    // subtestLabel('word')는 직역("Word comprehension")이 아니라
    // 용어 매핑 레이어(1-3)가 정한 웰니스 어휘를 낸다.
    await waitFor(() => expect(screen.getByText('Word activity')).toBeInTheDocument());
    expect(
      screen.getByText(
        /Accuracy by assessment for what your loved one has answered/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/helped 2 times/)).toBeInTheDocument();
  });

  it('프로필 화면 — 로딩·제목·라벨이 영어', async () => {
    get.mockResolvedValue(null);
    render(<ProfileScreen onBack={() => {}} />);
    expect(await screen.findByText('Patient info')).toBeInTheDocument();
    expect(screen.getByText('Basic info')).toBeInTheDocument();
    expect(screen.getByText('Hometown')).toBeInTheDocument();
    expect(screen.getByText('Family members')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('주차별 기록 — 빈 상태 안내가 영어(검사 이름은 아직 한국어)', async () => {
    vi.spyOn(quizApi, 'getQabTrend').mockResolvedValue([
      {
        subtest: 'sentence',
        points: [
          {
            weekStart: '2026-07-06',
            total: 10,
            correct: 4,
            accuracy: 40,
            avgScore: null,
            avgMetric: null,
          },
        ],
        deltaFromPrevious: null,
      } as QabTrendSeries,
    ]);
    render(<WeeklyReportScreen onBack={() => {}} />);
    expect(
      await screen.findByText('Language & cognition assessment record'),
    ).toBeInTheDocument();
    expect(screen.getByText('Patient')).toBeInTheDocument();
    expect(screen.getByText('Reading this record')).toBeInTheDocument();
  });

  it('기억 상세 — 로딩·라벨이 영어', async () => {
    getById.mockResolvedValue({
      id: 'e1',
      patientId: 'p1',
      photoUrl: null,
      locationTag: '여의도',
      objectTags: null,
      emotionTag: null,
      targetWords: [],
      hasScenario: false,
      hasMaskedContext: false,
      patientNotes: [],
      createdAt: '2026-01-01T00:00:00Z',
    });
    render(
      <EntryDetailScreen
        entryId="e1"
        scenarioStatus="idle"
        onTriggerScenario={async () => {}}
        onBack={() => {}}
      />,
    );
    expect(await screen.findByText('Training target words')).toBeInTheDocument();
    expect(screen.getByText('AI processing status')).toBeInTheDocument();
    expect(screen.getByText('Memory analysis')).toBeInTheDocument();
    expect(screen.getByText('Place')).toBeInTheDocument();
  });
});
