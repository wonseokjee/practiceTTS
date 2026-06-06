import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QuizService } from '../quiz.service';

/** memory-entry.created 이벤트 페이로드 */
interface MemoryEntryCreatedEvent {
  memoryEntryId: string;
}

/**
 * 라이프로그 생성 이벤트 → 퀴즈 자동 생성 리스너 (R1=(c) 자동 트리거).
 *
 * 디커플링 핵심: MemoryModule은 QuizService를 직접 호출하지 않는다.
 * MemoryEntryService가 EventEmitter2로 'memory-entry.created'를 발행하고,
 * 본 리스너(QuizModule 소속)가 이를 구독하여 퀴즈 생성을 시작한다.
 *
 * fire-and-forget: 생성 실패는 로깅만 하고 throw하지 않는다
 * (라이프로그 저장 자체는 이미 완료된 상태이므로 사용자 흐름을 막지 않는다).
 */
@Injectable()
export class QuizGenerationListener {
  private readonly logger = new Logger(QuizGenerationListener.name);

  constructor(private readonly quizService: QuizService) {}

  @OnEvent('memory-entry.created')
  async handleMemoryEntryCreated(
    payload: MemoryEntryCreatedEvent,
  ): Promise<void> {
    try {
      await this.quizService.generateForMemoryEntry(payload.memoryEntryId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.warn(
        `자동 퀴즈 생성 실패 (memoryEntryId=${payload.memoryEntryId}): ${message}`,
      );
    }
  }
}
