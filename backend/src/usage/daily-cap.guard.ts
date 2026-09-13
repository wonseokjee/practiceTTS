import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { User } from '../auth/entities/user.entity';
import { resolveEffectivePatientId } from '../auth/effective-patient-id.util';
import type { GenerationKind } from './daily-generation-caps';
import { GenerationUsageService } from './generation-usage.service';

export const DAILY_CAP_KEY = 'daily-generation-cap';

/** 429 본문의 code — 프론트가 이 값으로 "오늘은 여기까지" 안내를 고른다. */
export const DAILY_GENERATION_LIMIT = 'DAILY_GENERATION_LIMIT';

/**
 * 라우트에 일일 생성 상한을 건다. `@UseGuards(DailyCapGuard)`와 같이 붙인다.
 *
 * 가드로 두는 이유는 `RateLimitGuard`와 같다 — 가드는 인터셉터보다 먼저 돌아
 * 기억 등록의 사진 업로드(multer)가 시작되기 전에 거절한다. 클래스 레벨의
 * `JwtAuthGuard`·`OnboardingGuard` 뒤에 돌므로 `req.user`가 있다.
 */
export const DailyCap = (kind: GenerationKind) =>
  SetMetadata(DAILY_CAP_KEY, kind);

@Injectable()
export class DailyCapGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usage: GenerationUsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.get<GenerationKind | undefined>(
      DAILY_CAP_KEY,
      context.getHandler(),
    );
    if (!kind) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user: User }>();
    // 보호자는 연결된 환자, 환자는 본인 — 가구 하나에 상한 하나.
    const patientId = resolveEffectivePatientId(request.user);
    const decision = await this.usage.consume(patientId, kind);
    if (decision.allowed) {
      return true;
    }

    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: DAILY_GENERATION_LIMIT,
        kind,
        limit: decision.limit,
        retryAfter: decision.retryAfterSeconds,
        message: '오늘은 여기까지예요. 내일 다시 이어서 해요.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
