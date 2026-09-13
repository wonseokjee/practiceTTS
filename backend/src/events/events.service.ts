import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppEvent } from './entities/event.entity';
import {
  isKnownEventName,
  unknownPayloadKeys,
  type EventName,
} from './event-registry';

/**
 * 이벤트 기록의 유일한 쓰기 경로. `EventsController`(사용자가 보낸 이벤트)와
 * `TrackViewInterceptor`(서버가 GET 성공 후 자동 기록)가 둘 다 이 서비스를 거친다
 * — 검증 규칙이 한 곳에만 있어야 나중에 어긋나지 않는다.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectRepository(AppEvent)
    private readonly eventRepository: Repository<AppEvent>,
  ) {}

  /**
   * 클라이언트가 직접 요청한 이벤트를 기록한다. 등록 안 된 이름·이벤트에 안
   * 맞는 payload 키는 **거부**한다(400) — `ValidationPipe`가 DTO 최상위
   * 필드에 이미 하는 것과 같은 규칙(조용히 지우지 않는다, 계획 §13-4의 3-1).
   */
  async recordRequested(
    userId: string,
    eventName: string,
    payload: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!isKnownEventName(eventName)) {
      throw new BadRequestException(`등록되지 않은 이벤트입니다: ${eventName}`);
    }
    const rejected = unknownPayloadKeys(eventName, payload);
    if (rejected.length > 0) {
      throw new BadRequestException(
        `이벤트 "${eventName}"에 허용되지 않는 필드입니다: ${rejected.join(', ')}`,
      );
    }
    await this.insert(userId, eventName, payload ?? null);
  }

  /**
   * 서버가 스스로 기록하는 열람 이벤트(`TrackViewInterceptor`).
   *
   * **실패해도 던지지 않는다** — 여기서 예외가 나면 정상 응답을 받은 요청이
   * 계측 실패 때문에 500으로 바뀐다. 원본 응답이 이미 나간 뒤(성공 후, `tap`)
   * 호출되므로 막을 방법도 없다. 그래서 인터셉터가 아니라 여기서 삼키고
   * warn만 남긴다(Error Registry: "@TrackView | 기록 실패 | 응답을 막지 않음").
   *
   * `eventName`은 호출부(`@TrackView` 데코레이터 값)가 항상 레지스트리에
   * 있는 값으로 코드에 박아 넣는다 — 사용자 입력이 아니므로 여기서 다시
   * 검증하지 않는다(등록 안 된 이름을 넘기면 그건 배선 버그이고, 그 경우엔
   * 아래 catch가 잡아 warn으로 남긴다).
   */
  async recordViewed(
    userId: string,
    eventName: EventName,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      await this.insert(userId, eventName, payload);
    } catch (error) {
      this.logger.warn(
        `열람 이벤트 기록 실패: ${eventName} (user=${userId}) — ${(error as Error).message}`,
      );
    }
  }

  private async insert(
    userId: string,
    eventName: string,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    await this.eventRepository.save(
      this.eventRepository.create({ userId, eventName, payload }),
    );
  }
}
