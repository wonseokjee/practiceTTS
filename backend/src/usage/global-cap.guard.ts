import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { GlobalCapKind } from './daily-global-caps';
import { DAILY_GENERATION_LIMIT } from './daily-cap.guard';
import { GlobalUsageService } from './global-usage.service';

export const GLOBAL_CAP_KEY = 'global-daily-cap';

/**
 * 라우트에 서비스 전체 일일 상한을 건다. `@UseGuards(GlobalCapGuard)`와 같이 붙인다.
 *
 * **`DailyCapGuard` 뒤에 둔다.** 가구별 상한에 먼저 걸리면 전체 카운터를 올리지 않는다
 * — 한 가구가 폭주해도 다른 가구의 몫(전체 상한)을 갉아먹지 않게.
 * 가드라 인터셉터(multer)보다 먼저 돌아, 상한을 넘으면 업로드를 받기 전에 거절한다.
 */
export const GlobalCap = (kind: GlobalCapKind) =>
  SetMetadata(GLOBAL_CAP_KEY, kind);

@Injectable()
export class GlobalCapGuard implements CanActivate {
  private readonly logger = new Logger(GlobalCapGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly usage: GlobalUsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.get<GlobalCapKind | undefined>(
      GLOBAL_CAP_KEY,
      context.getHandler(),
    );
    if (!kind) {
      return true;
    }

    const decision = await this.usage.consume(kind);
    if (decision.allowed) {
      return true;
    }

    // 정확히 넘는 순간 한 번만 — 비용 폭주·해킹 신호라 pm2 로그에서 찾을 수 있게 남긴다.
    if (decision.count === decision.limit + 1) {
      this.logger.error(
        `전체 일일 상한 도달: ${kind} ${decision.limit}건 — 이후 오늘은 전부 429. ` +
          `비정상 트래픽이면 계정·키를 점검할 것.`,
      );
    }

    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        // 프론트가 이미 처리하는 코드를 재사용한다 — "오늘은 여기까지" 안내가 그대로 뜬다.
        code: DAILY_GENERATION_LIMIT,
        scope: 'global',
        kind,
        limit: decision.limit,
        retryAfter: decision.retryAfterSeconds,
        message:
          '지금은 이용이 많아 오늘은 여기까지예요. 내일 다시 이어서 해요.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
