import { describe, it, expect, vi } from 'vitest';
import { SubmitRepetitionAnswerUseCase } from './SubmitRepetitionAnswerUseCase';
import type { IRepetitionResultRepository, RepetitionResult } from '../../domain/RepetitionTypes';

// Mock 의존성
class MockRepository implements IRepetitionResultRepository {
  public savedResults: RepetitionResult[] = [];
  async saveResult(sessionId: string, result: RepetitionResult): Promise<void> {
    this.savedResults.push(result);
  }
  async getResultsBySession(sessionId: string): Promise<RepetitionResult[]> {
    return this.savedResults;
  }
}

describe('SubmitRepetitionAnswerUseCase 단위 테스트', () => {
  it('정상적인 입력이 들어오면 점수를 계산하여 Repository에 저장한다', async () => {
    const mockRepo = new MockRepository();
    const useCase = new SubmitRepetitionAnswerUseCase(mockRepo, 'session-123');

    // 완벽 일치하는 입력으로 모의
    const result = await useCase.execute({
      itemId: 'ITEM-1',
      stimulusText: '사과',
      sttOutput: '사과',
      reactionTimeMs: 1500,
      recordDurationMs: 2000
    });

    expect(result.score).toBe(2);
    expect(result.wer).toBe(0);
    expect(result.isCorrect).toBe(true);

    // 저장소에 전달되었는지 확인
    expect(mockRepo.savedResults.length).toBe(1);
    expect(mockRepo.savedResults[0].itemId).toBe('ITEM-1');
  });

  it('말씀이 없을 때(빈 텍스트) 무반응으로 간주되어 0점이 반환되고 저장된다', async () => {
    const mockRepo = new MockRepository();
    const useCase = new SubmitRepetitionAnswerUseCase(mockRepo, 'session-123');

    const result = await useCase.execute({
      itemId: 'ITEM-2',
      stimulusText: '바나나를 먹어요',
      sttOutput: ' ',
      reactionTimeMs: 0,
      recordDurationMs: 0
    });

    expect(result.score).toBe(0);
    expect(result.wer).toBe(1); // 1.0 (100% 에러)
    expect(result.isCorrect).toBe(false);

    expect(mockRepo.savedResults.length).toBe(1);
    expect(mockRepo.savedResults[0].itemId).toBe('ITEM-2');
  });

  it('Repository 저장 실패 시 RepetitionError 예외를 던진다', async () => {
    const mockRepo = new MockRepository();
    mockRepo.saveResult = vi.fn().mockRejectedValue(new Error('DB 연결 끊김'));

    const useCase = new SubmitRepetitionAnswerUseCase(mockRepo, 'session-123');

    await expect(useCase.execute({
      itemId: 'ITEM-3',
      stimulusText: '안녕',
      sttOutput: '안녕',
      reactionTimeMs: 1000,
      recordDurationMs: 1000
    })).rejects.toThrow('채점 결과를 저장하는 과정에서 오류가 발생했습니다.');
  });
});
