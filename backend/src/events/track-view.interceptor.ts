import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { User } from '../auth/entities/user.entity';
import { EventsService } from './events.service';
import { TRACK_VIEW_KEY } from './track-view.decorator';
import type { EventName } from './event-registry';

interface AuthedRequest {
  user?: User;
  headers: Record<string, string | string[] | undefined>;
}

/** 프론트가 아직 안 보내면 이렇게 남는다 — "모른다"이지 지어낸 값이 아니다. */
const UNKNOWN_SCREEN = 'unknown';

/**
 * `@TrackView`가 붙은 라우트의 GET이 **성공적으로 끝난 뒤** 열람 이벤트를 남긴다.
 *
 * 전역으로 등록해 두고(`EventsModule`) 데코레이터가 없는 라우트는 그대로
 * 통과시킨다 — 매 컨트롤러에 `@UseInterceptors`를 붙이는 걸 잊는 실패 모드를
 * 없앤다.
 *
 * `qab-trend`처럼 같은 엔드포인트를 **리포트 화면과 대시보드 카드가 함께 쓰는**
 * 경우, 서버는 요청 파라미터만으로 어느 화면인지 못 가른다(주간 수 8 vs 12는
 * 프론트가 우연히 같은 값을 쓰면 무너지는 신호다). 그래서 프론트가 보내는
 * `X-Screen-Name` 헤더로 화면을 가른다. 아직 아무 화면도 이 헤더를 안 보내므로
 * (프론트 작업은 후속, T10) 지금은 전부 "unknown"으로 쌓인다 — 헤더가 실제로
 * 붙기 전까지는 정직하게 "모른다"로 남아야 한다.
 */
@Injectable()
export class TrackViewInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly events: EventsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const eventName = this.reflector.getAllAndOverride<EventName | undefined>(
      TRACK_VIEW_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!eventName) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    return next.handle().pipe(
      tap(() => {
        const userId = request.user?.id;
        // JwtAuthGuard 뒤에서만 쓰는 라우트라 항상 있어야 하지만, 없으면
        // 조용히 건너뛴다 — 응답은 이미 나갔고 이건 부가 기록일 뿐이다.
        if (!userId) return;
        const screenHeader = request.headers['x-screen-name'];
        const screen = Array.isArray(screenHeader)
          ? (screenHeader[0] ?? UNKNOWN_SCREEN)
          : (screenHeader ?? UNKNOWN_SCREEN);
        void this.events.recordViewed(userId, eventName, { screen });
      }),
    );
  }
}
