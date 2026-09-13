import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppEvent } from './entities/event.entity';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { TrackViewInterceptor } from './track-view.interceptor';

/**
 * `TrackViewInterceptor`를 전역으로 등록한다 — `@TrackView`가 붙은 라우트만
 * 실제로 기록하고, 나머지는 리플렉터 조회 한 번으로 그냥 통과한다(다른 전역
 * 가드 없음, 오버헤드 무시할 수준).
 */
@Module({
  imports: [TypeOrmModule.forFeature([AppEvent])],
  controllers: [EventsController],
  providers: [
    EventsService,
    { provide: APP_INTERCEPTOR, useClass: TrackViewInterceptor },
  ],
  exports: [EventsService],
})
export class EventsModule {}
