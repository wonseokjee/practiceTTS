import { describe, it, expect } from 'vitest';
import { createLocAssessmentResult } from './LocAssessmentResult.js';
import { createLocTrial } from './LocTrial.js';
import type { LocTrial } from './LocTrial.js';

const BASE_AUDIO_END = 5000;

function makeTrial(trialNumber: 1 | 2 | 3, latencyMs: number | null): LocTrial {
  return createLocTrial({
    trialNumber,
    audioEndTime: BASE_AUDIO_END,
    touchTime: latencyMs !== null ? BASE_AUDIO_END + latencyMs : null,
    touchInBounds: latencyMs !== null,
  });
}

const COMMON_PARAMS = {
  id: 'test-id-001',
  sessionId: 'session-001',
  patientId: 'patient-001',
  startTime: 0,
};

describe('createLocAssessmentResult - 불변 조건 검증', () => {
  it('trials가 빈 배열이면 에러를 던진다', () => {
    expect(() =>
      createLocAssessmentResult({ ...COMMON_PARAMS, trials: [] }),
    ).toThrow();
  });
});

describe('createLocAssessmentResult - finalScore 산출 (최고 점수 채택)', () => {
  it('trials = [score:1, score:3, score:2] 이면 finalScore = 3', () => {
    const trials: LocTrial[] = [
      makeTrial(1, 7_000),  // score 1 (중도 지연)
      makeTrial(2, 1_000),  // score 3 (정상)
      makeTrial(3, 4_000),  // score 2 (경도 지연)
    ];
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(result.finalScore).toBe(3);
  });

  it('모든 시도가 무반응이면 finalScore = 0', () => {
    const trials: LocTrial[] = [
      makeTrial(1, null),
      makeTrial(2, null),
      makeTrial(3, null),
    ];
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(result.finalScore).toBe(0);
  });

  it('단일 시도인 경우 해당 score가 finalScore가 된다', () => {
    const trials: LocTrial[] = [makeTrial(1, 2_000)]; // score 3
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(result.finalScore).toBe(3);
  });
});

describe('createLocAssessmentResult - 필드 검증', () => {
  it('전달한 id, sessionId, patientId가 그대로 저장된다', () => {
    const trials: LocTrial[] = [makeTrial(1, 1_000)];
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(result.id).toBe(COMMON_PARAMS.id);
    expect(result.sessionId).toBe(COMMON_PARAMS.sessionId);
    expect(result.patientId).toBe(COMMON_PARAMS.patientId);
  });

  it('trials는 전달된 배열의 복사본으로 저장된다 (참조 독립)', () => {
    const trials: LocTrial[] = [makeTrial(1, 1_000)];
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(result.trials).toHaveLength(1);
    expect(result.trials[0]).toEqual(trials[0]);
  });

  it('completedAt은 Date 인스턴스이다', () => {
    const trials: LocTrial[] = [makeTrial(1, 1_000)];
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('totalDurationMs는 0 이상이다', () => {
    const trials: LocTrial[] = [makeTrial(1, 1_000)];
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('createLocAssessmentResult - 불변성 (Object.freeze)', () => {
  it('결과 객체에 직접 속성 할당 시 TypeError가 발생한다', () => {
    const trials: LocTrial[] = [makeTrial(1, 1_000)];
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(() => {
      (result as { finalScore: number }).finalScore = 999;
    }).toThrow(TypeError);
  });

  it('trials 배열에 push 시도 시 TypeError가 발생한다', () => {
    const trials: LocTrial[] = [makeTrial(1, 1_000)];
    const result = createLocAssessmentResult({ ...COMMON_PARAMS, trials });
    expect(() => {
      (result.trials as LocTrial[]).push(makeTrial(2, 2_000));
    }).toThrow(TypeError);
  });
});
