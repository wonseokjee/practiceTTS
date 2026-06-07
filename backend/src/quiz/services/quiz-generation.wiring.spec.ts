import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { QuizService } from '../quiz.service';
import { QuizGenerationListener } from './quiz-generation.listener';

/**
 * [1→3] 이벤트 배선 통합 테스트 (TODO#1).
 *
 * 단위 테스트(listener.spec)는 handleMemoryEntryCreated를 직접 호출하므로
 * @OnEvent 데코레이터 + EventEmitterModule 실제 구독 배선은 검증하지 못한다.
 * 본 테스트는 EventEmitterModule.forRoot()를 실제로 부트스트랩하여
 * 'memory-entry.created' emit이 리스너를 거쳐 QuizService까지 도달하는지 확인한다.
 * (이벤트명 오타·구독 누락 같은 배선 회귀를 잡는다.)
 */
describe('Quiz 이벤트 배선 (memory-entry.created → 자동 생성)', () => {
  let moduleRef: TestingModule;
  let emitter: EventEmitter2;
  let generateMock: jest.Mock;

  beforeEach(async () => {
    generateMock = jest.fn().mockResolvedValue({ quizSetId: 'set-1' });

    moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        QuizGenerationListener,
        {
          provide: QuizService,
          useValue: { generateForMemoryEntry: generateMock },
        },
      ],
    }).compile();

    // @OnEvent 구독은 onApplicationBootstrap 시점에 등록되므로 init() 필요.
    await moduleRef.init();
    emitter = moduleRef.get(EventEmitter2);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it("'memory-entry.created' emit 시 QuizService.generateForMemoryEntry가 호출된다", async () => {
    emitter.emit('memory-entry.created', { memoryEntryId: 'mem-1' });

    // async 리스너 — 마이크로태스크/타이머 flush
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledWith('mem-1');
  });

  it('관련 없는 이벤트명에는 반응하지 않는다 (구독 범위 검증)', async () => {
    emitter.emit('some-other.event', { memoryEntryId: 'mem-2' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(generateMock).not.toHaveBeenCalled();
  });

  it('리스너 내부 예외가 emit 호출자에게 전파되지 않는다 (fire-and-forget)', async () => {
    generateMock.mockRejectedValueOnce(new Error('LLM 다운'));

    // emit 자체는 throw하지 않아야 한다
    expect(() =>
      emitter.emit('memory-entry.created', { memoryEntryId: 'mem-3' }),
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generateMock).toHaveBeenCalledWith('mem-3');
  });
});
