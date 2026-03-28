import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinishLocAssessmentUseCase } from './FinishLocAssessmentUseCase.js';
import type { ILocResultRepository } from '../domain/ILocResultRepository.js';
import { createLocTrial } from '../domain/LocTrial.js';
import type { LocTrial } from '../domain/LocTrial.js';

function makeTrial(trialNumber: 1 | 2 | 3, latencyMs: number | null): LocTrial {
  return createLocTrial({
    trialNumber,
    audioEndTime: 5000,
    touchTime: latencyMs !== null ? 5000 + latencyMs : null,
    touchInBounds: latencyMs !== null,
  });
}

function makeMockRepository(saveFn?: () => Promise<void>): ILocResultRepository {
  return {
    save: vi.fn().mockImplementation(saveFn ?? (() => Promise.resolve())),
    findById: vi.fn().mockResolvedValue(null),
    findBySessionId: vi.fn().mockResolvedValue(null),
  };
}

const COMMON_PARAMS = {
  id: 'result-001',
  sessionId: 'session-001',
  patientId: 'P001',
  startTime: performance.now() - 10_000,
};

describe('FinishLocAssessmentUseCase.execute()', () => {
  let repository: ILocResultRepository;
  let useCase: FinishLocAssessmentUseCase;

  beforeEach(() => {
    repository = makeMockRepository();
    useCase = new FinishLocAssessmentUseCase(repository);
  });

  it('정상 실행 시 LocAssessmentResultDTO를 반환한다', async () => {
    const trials = [makeTrial(1, 2000), makeTrial(2, 5000), makeTrial(3, null)];
    const result = await useCase.execute({ ...COMMON_PARAMS, trials });

    expect(result.id).toBe('result-001');
    expect(result.finalScore).toBe(3); // trial 1의 2000ms → score 3
    expect(result.trials).toHaveLength(3);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('repository.save()가 호출된다', async () => {
    const trials = [makeTrial(1, 2000)];
    await useCase.execute({ ...COMMON_PARAMS, trials });

    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('STORAGE_FAILED는 비중단 — repository.save() 실패해도 DTO를 반환한다', async () => {
    repository = makeMockRepository(() => Promise.reject(new Error('LocalStorage 꽉 참')));
    useCase = new FinishLocAssessmentUseCase(repository);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const trials = [makeTrial(1, 2000)];
    // 저장 실패에도 불구하고 에러를 던지지 않고 DTO를 반환해야 한다
    await expect(useCase.execute({ ...COMMON_PARAMS, trials })).resolves.toBeDefined();

    consoleSpy.mockRestore();
  });

  it('마지막 trial의 isComplete만 true이다', async () => {
    const trials = [makeTrial(1, 7000), makeTrial(2, 8000), makeTrial(3, null)];
    const result = await useCase.execute({ ...COMMON_PARAMS, trials });

    expect(result.trials[0].isComplete).toBe(false);
    expect(result.trials[1].isComplete).toBe(false);
    expect(result.trials[2].isComplete).toBe(true);
  });

  it('trials의 finalScore는 최고 점수를 반환한다', async () => {
    const trials = [makeTrial(1, 7000), makeTrial(2, 1000), makeTrial(3, null)];
    // trial 2: 1000ms → score 3
    const result = await useCase.execute({ ...COMMON_PARAMS, trials });

    expect(result.finalScore).toBe(3);
  });
});
