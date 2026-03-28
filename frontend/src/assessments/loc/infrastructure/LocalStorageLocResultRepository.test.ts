import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageLocResultRepository } from './LocalStorageLocResultRepository.js';
import { createLocTrial } from '../domain/LocTrial.js';
import { createLocAssessmentResult } from '../domain/LocAssessmentResult.js';
import type { LocAssessmentResult } from '../domain/LocAssessmentResult.js';

// LocalStorage Mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

function makeResult(id: string = 'result-001'): LocAssessmentResult {
  const trial = createLocTrial({
    trialNumber: 1,
    audioEndTime: 5000,
    touchTime: 6000,
    touchInBounds: true,
  });
  return createLocAssessmentResult({
    id,
    sessionId: 'session-001',
    patientId: 'P001',
    trials: [trial],
    startTime: performance.now() - 5000,
  });
}

describe('LocalStorageLocResultRepository', () => {
  let repo: LocalStorageLocResultRepository;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    repo = new LocalStorageLocResultRepository();
  });

  it('save() 후 findById()로 동일한 결과를 복원한다', async () => {
    const original = makeResult();
    await repo.save(original);

    const found = await repo.findById(original.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(original.id);
    expect(found!.sessionId).toBe(original.sessionId);
    expect(found!.finalScore).toBe(original.finalScore);
    expect(found!.trials).toHaveLength(1);
  });

  it('findById()에 없는 id → null 반환', async () => {
    const result = await repo.findById('nonexistent');
    expect(result).toBeNull();
  });

  it('findBySessionId()로 세션 ID로 조회 가능', async () => {
    const result = makeResult();
    await repo.save(result);

    const found = await repo.findBySessionId('session-001');
    expect(found).not.toBeNull();
    expect(found!.sessionId).toBe('session-001');
  });

  it('schemaVersion 없는 구 데이터도 역직렬화된다 (하위호환성)', async () => {
    // schemaVersion 필드 없는 구 포맷으로 직접 LocalStorage에 주입
    const legacyData = {
      'result-legacy': {
        // schemaVersion 없음
        id: 'result-legacy',
        sessionId: 'session-legacy',
        patientId: 'P002',
        trials: [
          {
            trialNumber: 1,
            audioEndTime: 5000,
            touchTime: 6500,
            latency: 1500,
            touchInBounds: true,
            score: 2,
          },
        ],
        finalScore: 2,
        completedAt: new Date().toISOString(),
        totalDurationMs: 8000,
      },
    };
    localStorageMock.setItem('loc_assessment_results', JSON.stringify(legacyData));

    const found = await repo.findById('result-legacy');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('result-legacy');
    expect(found!.finalScore).toBe(2);
  });

  it('여러 결과를 저장하고 각각 조회 가능', async () => {
    const result1 = makeResult('result-001');
    const result2 = makeResult('result-002');
    await repo.save(result1);
    await repo.save(result2);

    const found1 = await repo.findById('result-001');
    const found2 = await repo.findById('result-002');
    expect(found1!.id).toBe('result-001');
    expect(found2!.id).toBe('result-002');
  });

  it('save() 시 schemaVersion: 1이 포함된다', async () => {
    const result = makeResult();
    await repo.save(result);

    const raw = JSON.parse(localStorageMock.setItem.mock.calls[0][1] as string);
    expect(raw['result-001'].schemaVersion).toBe(1);
  });
});
