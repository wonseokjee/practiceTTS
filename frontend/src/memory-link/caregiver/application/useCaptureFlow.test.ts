// useCaptureFlow.ts — 3-step FSM 단위 테스트
//
// 검증 포인트 (Implementation Plan Phase 4 / Phase 1 §13 P1-N5):
//  - mood 미선택 시 next() 차단
//  - myDay 건너뛰기 가능
//  - patientDay: 답변 모두 비고 photo도 없으면 submit 차단
//  - submit 성공/실패 흐름

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCaptureFlow } from './useCaptureFlow.js';
import type { IMemoryEntryApi } from '../infrastructure/MemoryEntryApi.js';
import type { IDiaryQuestionApi } from '../infrastructure/DiaryQuestionApi.js';
import type { DiaryQuestion } from '../domain/CaptureFlow.js';
import type { MemoryEntry } from '../domain/MemoryEntry.js';

const PATIENT_ID = 'patient-uuid-1';

const CAREGIVER_QUESTION: DiaryQuestion = {
  id: 'q-caregiver-1',
  scope: 'caregiver',
  category: null,
  text: '오늘 본인을 위해 한 작은 일이 있나요?',
};

const PATIENT_QUESTION_ACTIVITY: DiaryQuestion = {
  id: 'q-patient-act-1',
  scope: 'patient',
  category: 'activity',
  text: '오늘 어떤 활동을 함께 하셨나요?',
};

const PATIENT_QUESTION_MOMENT: DiaryQuestion = {
  id: 'q-patient-mom-1',
  scope: 'patient',
  category: 'moment',
  text: '오늘 기억에 남는 순간이 있었나요?',
};

const PATIENT_QUESTION_CONTEXT: DiaryQuestion = {
  id: 'q-patient-ctx-1',
  scope: 'patient',
  category: 'context',
  text: '오늘 만난 사람·장소·음식이 있나요?',
};

const FAKE_MEMORY_ENTRY: MemoryEntry = {
  id: 'entry-uuid-1',
  patientId: PATIENT_ID,
  photoUrl: null,
  locationTag: null,
  objectTags: null,
  emotionTag: null,
  targetWords: [],
  hasScenario: false,
  hasMaskedContext: false,
  createdAt: '2026-05-27T09:00:00Z',
};

function makeMockQuestionApi(): IDiaryQuestionApi {
  return {
    fetchToday: vi.fn(async ({ scope, category }) => {
      if (scope === 'caregiver') return CAREGIVER_QUESTION;
      if (category === 'activity') return PATIENT_QUESTION_ACTIVITY;
      if (category === 'moment') return PATIENT_QUESTION_MOMENT;
      return PATIENT_QUESTION_CONTEXT;
    }),
  };
}

function makeMockEntryApi(
  overrides?: Partial<IMemoryEntryApi>,
): IMemoryEntryApi {
  return {
    create: vi.fn(async () => FAKE_MEMORY_ENTRY),
    getAll: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    triggerScenario: vi.fn(),
    ...overrides,
  } as unknown as IMemoryEntryApi;
}

describe('useCaptureFlow', () => {
  beforeAll(() => {
    // jsdom의 URL.createObjectURL은 실제 Blob URL을 생성하므로
    // 단위 테스트에서는 결정적인 stub으로 대체한다.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock-url'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it('마운트 시 질문 4종(caregiver + patient×3)을 prefetch한다', async () => {
    const questionApi = makeMockQuestionApi();
    const entryApi = makeMockEntryApi();

    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: entryApi,
        diaryQuestionApi: questionApi,
      }),
    );

    await waitFor(() => {
      expect(result.current.caregiverQuestion).not.toBeNull();
      expect(result.current.patientQuestions.activity).not.toBeNull();
      expect(result.current.patientQuestions.moment).not.toBeNull();
      expect(result.current.patientQuestions.context).not.toBeNull();
    });

    expect(questionApi.fetchToday).toHaveBeenCalledTimes(4);
  });

  it('mood 미선택 시 next()를 호출해도 step이 진행되지 않고 에러가 표시된다', async () => {
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: makeMockEntryApi(),
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    expect(result.current.step).toBe('mood');

    await act(async () => {
      result.current.next();
    });

    expect(result.current.step).toBe('mood');
    expect(result.current.error).toMatch(/마음을 선택/);
  });

  it('mood 선택 후 next()를 호출하면 myDay 단계로 진행된다', async () => {
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: makeMockEntryApi(),
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    act(() => result.current.setMood(4));
    act(() => result.current.next());

    expect(result.current.step).toBe('myDay');
    expect(result.current.error).toBeNull();
  });

  it('myDay 단계는 답변 없이도 건너뛰기로 patientDay로 진행 가능하다', () => {
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: makeMockEntryApi(),
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    act(() => result.current.setMood(3));
    act(() => result.current.next()); // mood → myDay
    act(() => result.current.next()); // myDay → patientDay (건너뛰기)

    expect(result.current.step).toBe('patientDay');
    expect(result.current.caregiverAnswerText).toBe('');
  });

  it('prev()로 이전 단계로 복귀할 수 있다', () => {
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: makeMockEntryApi(),
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    act(() => result.current.setMood(5));
    act(() => result.current.next()); // myDay
    act(() => result.current.next()); // patientDay

    act(() => result.current.prev()); // myDay
    expect(result.current.step).toBe('myDay');

    act(() => result.current.prev()); // mood
    expect(result.current.step).toBe('mood');
  });

  it('patientDay에서 답변/사진 모두 없으면 submit이 차단된다', async () => {
    const entryApi = makeMockEntryApi();
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: entryApi,
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    await waitFor(() => {
      expect(result.current.patientQuestions.activity).not.toBeNull();
    });

    act(() => result.current.setMood(3));
    act(() => result.current.next());
    act(() => result.current.next());

    await act(async () => {
      await result.current.submit();
    });

    expect(entryApi.create).not.toHaveBeenCalled();
    expect(result.current.step).toBe('patientDay');
    expect(result.current.error).toMatch(/사진 첨부/);
  });

  it('patientAnswers 1개 입력 + submit 성공 시 done 단계로 진입한다', async () => {
    const entryApi = makeMockEntryApi();
    const questionApi = makeMockQuestionApi();
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: entryApi,
        diaryQuestionApi: questionApi,
      }),
    );

    // 질문 prefetch 완료 대기
    await waitFor(() => {
      expect(result.current.patientQuestions.activity).not.toBeNull();
    });

    act(() => result.current.setMood(4));
    act(() => result.current.next()); // myDay
    act(() => result.current.next()); // patientDay
    act(() => result.current.setPatientAnswerText('activity', '공원에 다녀왔다'));

    await act(async () => {
      await result.current.submit();
    });

    expect(entryApi.create).toHaveBeenCalledOnce();
    const callArgs = (entryApi.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(callArgs).toMatchObject({
      patientId: PATIENT_ID,
      mood: { level: 4 },
    });
    expect(callArgs.patientAnswers).toHaveLength(1);
    expect(callArgs.patientAnswers[0]).toMatchObject({
      questionId: PATIENT_QUESTION_ACTIVITY.id,
      category: 'activity',
      answerText: '공원에 다녀왔다',
    });
    expect(callArgs.photo).toBeUndefined();
    expect(callArgs.caregiverAnswer).toBeUndefined();

    expect(result.current.step).toBe('done');
    expect(result.current.createdEntry).toEqual(FAKE_MEMORY_ENTRY);
  });

  it('사진만 첨부해도 submit이 통과한다 (백엔드 OR 검증과 일관)', async () => {
    const entryApi = makeMockEntryApi();
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: entryApi,
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    await waitFor(() => {
      expect(result.current.patientQuestions.activity).not.toBeNull();
    });

    const fakeFile = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

    act(() => result.current.setMood(3));
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.setPhoto(fakeFile));

    await act(async () => {
      await result.current.submit();
    });

    await waitFor(() => {
      expect(result.current.step).toBe('done');
    });

    expect(entryApi.create).toHaveBeenCalledOnce();
    const callArgs = (entryApi.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(callArgs.photo).toBe(fakeFile);
    expect(callArgs.patientAnswers).toHaveLength(0);
  });

  it('caregiverAnswerText가 있으면 caregiverAnswer 페이로드가 포함된다', async () => {
    const entryApi = makeMockEntryApi();
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: entryApi,
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    await waitFor(() => {
      expect(result.current.caregiverQuestion).not.toBeNull();
    });

    act(() => result.current.setMood(2));
    act(() => result.current.next()); // myDay
    act(() => result.current.setCaregiverAnswerText('힘들었지만 버텼다'));
    act(() => result.current.next()); // patientDay
    act(() => result.current.setPatientAnswerText('moment', '저녁에 산책'));

    await act(async () => {
      await result.current.submit();
    });

    const callArgs = (entryApi.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(callArgs.caregiverAnswer).toEqual({
      questionId: CAREGIVER_QUESTION.id,
      answerText: '힘들었지만 버텼다',
    });
  });

  it('submit 실패 시 step은 patientDay로 복귀하고 error가 표시된다', async () => {
    const entryApi = makeMockEntryApi({
      create: vi.fn(async () => {
        throw new Error('서버 오류');
      }),
    });

    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: entryApi,
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    await waitFor(() => {
      expect(result.current.patientQuestions.activity).not.toBeNull();
    });

    act(() => result.current.setMood(3));
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.setPatientAnswerText('activity', '공원'));

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.step).toBe('patientDay');
    expect(result.current.error).toBe('서버 오류');
    expect(result.current.createdEntry).toBeNull();
  });

  it('300자 초과 입력은 자동으로 잘려서 저장된다', () => {
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: makeMockEntryApi(),
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    const longText = 'a'.repeat(350);
    act(() => result.current.setPatientAnswerText('activity', longText));

    expect(result.current.patientAnswers.activity.length).toBe(300);
  });

  it('prefetch 실패 후 답변을 입력하면 제출이 차단되고(유실 방지) 에러가 표시된다', async () => {
    const entryApi = makeMockEntryApi();
    const failingQuestionApi: IDiaryQuestionApi = {
      fetchToday: vi.fn(async () => {
        throw new Error('질문 서버 오류');
      }),
    };

    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: entryApi,
        diaryQuestionApi: failingQuestionApi,
      }),
    );

    // prefetch 실패로 에러가 표시되고 질문은 null 상태
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.patientQuestions.activity).toBeNull();

    act(() => result.current.setMood(3));
    act(() => result.current.next()); // myDay
    act(() => result.current.next()); // patientDay
    // 질문이 없어도 사용자가 답을 입력할 수 있는 상황을 가정
    act(() => result.current.setPatientAnswerText('activity', '공원에 다녀왔다'));

    await act(async () => {
      await result.current.submit();
    });

    // 답변이 조용히 유실되지 않도록 제출 차단 + 명확한 에러
    expect(entryApi.create).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/다시 시도/);
  });

  it('retryQuestions()로 prefetch를 다시 시도하면 질문이 채워진다', async () => {
    let shouldFail = true;
    const flakyQuestionApi: IDiaryQuestionApi = {
      fetchToday: vi.fn(async ({ scope, category }) => {
        if (shouldFail) throw new Error('일시적 오류');
        if (scope === 'caregiver') return CAREGIVER_QUESTION;
        if (category === 'activity') return PATIENT_QUESTION_ACTIVITY;
        if (category === 'moment') return PATIENT_QUESTION_MOMENT;
        return PATIENT_QUESTION_CONTEXT;
      }),
    };

    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: makeMockEntryApi(),
        diaryQuestionApi: flakyQuestionApi,
      }),
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    // 다음 호출은 성공하도록 전환 후 재시도
    shouldFail = false;
    await act(async () => {
      result.current.retryQuestions();
    });

    await waitFor(() => {
      expect(result.current.patientQuestions.activity).not.toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  it('reset() 호출 시 모든 상태가 초기화된다', async () => {
    const { result } = renderHook(() =>
      useCaptureFlow(PATIENT_ID, {
        memoryEntryApi: makeMockEntryApi(),
        diaryQuestionApi: makeMockQuestionApi(),
      }),
    );

    act(() => result.current.setMood(5));
    act(() => result.current.setPatientAnswerText('activity', 'foo'));
    act(() => result.current.reset());

    expect(result.current.step).toBe('mood');
    expect(result.current.mood).toBeNull();
    expect(result.current.patientAnswers.activity).toBe('');
    expect(result.current.error).toBeNull();
  });
});
