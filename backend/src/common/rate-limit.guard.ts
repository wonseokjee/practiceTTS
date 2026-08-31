import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { SlidingWindowRateLimiter } from './sliding-window-rate-limiter';

/** 라우트에 붙는 레이트리밋 설정. */
export interface RateLimitOptions {
  /** 버킷 이름. 라우트마다 달라야 서로 간섭하지 않는다. */
  name: string;
  /** 창 안에서 허용할 요청 수. */
  limit: number;
  /** 창 길이(ms). 기본 1분. */
  windowMs?: number;
}

export const RATE_LIMIT_KEY = 'rate-limit-options';

/**
 * 라우트에 사용자별 레이트리밋을 건다.
 *
 * **가드로 구현한 이유**가 핵심이다. 예전에는 핸들러 본문 첫 줄에서
 * 검사했는데, NestJS 실행 순서가 `가드 → 인터셉터 → 파이프 → 핸들러`라
 * `FileInterceptor`(multer)가 **먼저** 돌았다. 즉 한도를 넘긴 요청도
 * 매번 업로드 본문을 메모리에 다 올린 뒤에야 429를 받았다.
 *
 * 유효한 JWT 하나로 초당 수십 번 큰 파일을 보내면 429는 나가지만 그 전에
 * 요청마다 최대 크기가 힙에 쌓인다. 단일 인스턴스 배포라 백엔드가 OOM으로
 * 죽으면 사진·퀴즈·인증이 전부 같이 죽는다 — 레이트리밋이 지키려던 것을
 * 정작 못 지켰다.
 *
 * 가드는 인터셉터보다 먼저 돌므로 multer가 시작되기 전에 잘라낸다.
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

/** JwtAuthGuard가 주입한 사용자. */
interface AuthedRequest extends Request {
  user?: { id?: string };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  /** 버킷 이름 → 리미터. 라우트별로 하나씩 만들어 재사용한다. */
  private readonly limiters = new Map<string, SlidingWindowRateLimiter>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    // 이 가드는 반드시 JwtAuthGuard **뒤에** 놓아야 한다
    // (@UseGuards(JwtAuthGuard, RateLimitGuard) 순서).
    // 사용자를 못 찾으면 IP로 떨어뜨린다 — 프록시 뒤라 정확하진 않지만,
    // 키가 없다고 무제한으로 통과시키는 것보다 낫다.
    const key = request.user?.id ?? request.ip ?? 'unknown';

    const limiter = this.getLimiter(options);
    if (limiter.allow(key)) {
      return true;
    }

    const retryAfter = limiter.retryAfterSeconds(key);
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(retryAfter));

    throw new HttpException(
      {
        message: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private getLimiter(options: RateLimitOptions): SlidingWindowRateLimiter {
    const existing = this.limiters.get(options.name);
    if (existing) {
      return existing;
    }
    const created = new SlidingWindowRateLimiter(
      options.limit,
      options.windowMs ?? 60_000,
    );
    this.limiters.set(options.name, created);
    return created;
  }
}
