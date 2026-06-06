import { QuizService } from '../quiz.service';
import { QuizGenerationListener } from './quiz-generation.listener';

/**
 * QuizGenerationListener 단위 테스트 (자동 트리거 이벤트 핸들러).
 *
 * 검증 범위:
 *  - handleMemoryEntryCreated가 quizService.generateForMemoryEntry를 호출
 *  - generateForMemoryEntry가 throw해도 핸들러는 fire-and-forget으로
 *    예외를 삼키고 정상 resolve (라이프로그 흐름을 막지 않음)
 */
describe('QuizGenerationListener', () => {
  let listener: QuizGenerationListener;
  let quizServiceMock: { generateForMemoryEntry: jest.Mock };

  beforeEach(() => {
    quizServiceMock = {
      generateForMemoryEntry: jest.fn().mockResolvedValue({ quizSetId: 'qs-1' }),
    };
    listener = new QuizGenerationListener(
      quizServiceMock as unknown as QuizService,
    );
  });

  it('이벤트 수신 시 quizService.generateForMemoryEntry를 memoryEntryId로 호출해야 한다', async () => {
    await listener.handleMemoryEntryCreated({ memoryEntryId: 'mem-123' });

    expect(quizServiceMock.generateForMemoryEntry).toHaveBeenCalledTimes(1);
    expect(quizServiceMock.generateForMemoryEntry).toHaveBeenCalledWith(
      'mem-123',
    );
  });

  it('generateForMemoryEntry가 throw해도 핸들러는 예외를 전파하지 않고 resolve해야 한다 (fire-and-forget)', async () => {
    quizServiceMock.generateForMemoryEntry.mockRejectedValueOnce(
      new Error('LLM 생성 실패'),
    );

    // 핸들러 자체는 reject되지 않아야 한다
    await expect(
      listener.handleMemoryEntryCreated({ memoryEntryId: 'mem-456' }),
    ).resolves.toBeUndefined();

    expect(quizServiceMock.generateForMemoryEntry).toHaveBeenCalledWith(
      'mem-456',
    );
  });
});
