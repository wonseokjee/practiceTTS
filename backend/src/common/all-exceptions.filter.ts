import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `ValidationPipe`(`main.ts`)가 만드는 응답은 `message: string[]`이고, 각 원소는
 * class-validator 템플릿이라 항상 "<필드명> <서술어>…" 모양이다
 * (예: `"patientId should not be empty"`). 첫 단어가 필드명이다.
 */
function fieldNameOf(message: string): string {
  return message.split(' ')[0] || message;
}

/**
 * 검증 실패 응답에서 **필드명만** 뽑는다. `message` 배열의 나머지(서술어)는
 * 버린다 — 커스텀 밸리데이터가 실패한 값을 메시지에 끼워 넣어도 로그에 남지
 * 않게 하려는 것이다(가족 실명·기억 내용이 DTO 필드 값으로 들어올 수 있다).
 */
function extractFieldNames(body: unknown): string[] | null {
  if (!isRecord(body)) return null;
  const message = body.message;
  if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
    return [...new Set(message.map(fieldNameOf))];
  }
  return null;
}

/**
 * 전역 예외 필터 — QAB 저장 실패를 비롯한 4xx·5xx를 서버 로그에 남긴다.
 *
 * **문제(계획 §13 8-1).** 환자 기기가 QAB 결과 제출에 실패하면(네트워크,
 * `forbidNonWhitelisted` 400 등) 지금은 환자 브라우저 콘솔에만 남는다 — 아무도
 * 안 본다. 운영자가 알 방법이 없다.
 *
 * **로그에 무엇을 남기고 무엇을 안 남기는가.** `method · path · status ·
 * 예외 클래스명`, 검증 실패면 **필드명**까지. **요청 본문 값·예외 메시지 원문은
 * 남기지 않는다** — 가족 실명·기억 내용 같은 개인정보가 DTO 필드 값이나 커스텀
 * 예외 메시지에 실려 있을 수 있다. 5xx만 스택을 남긴다: 프로그래밍·인프라
 * 오류라 값이 아니라 코드 위치이고, 그게 없으면 운영자가 원인을 못 찾는다.
 *
 * 로그 볼륨은 `pm2-logrotate`가 관리한다(DEPLOYMENT.md).
 *
 * **다른 필터와의 관계.** 라우트에 `@UseFilters(SocialAuthExceptionFilter)`가
 * 붙은 곳은 NestJS가 더 구체적인 필터를 우선하므로 이 전역 필터를 안 탄다 —
 * 여기서 별도 예외 처리를 하지 않는다.
 *
 * `HttpAdapterHost`를 쓰는 이유는 NestJS 공식 권장 패턴이다: `APP_FILTER`
 * 토큰으로 등록하면 DI 시점에 어댑터가 아직 없을 수 있어, 매 요청 시점에
 * `httpAdapterHost.httpAdapter`를 읽어야 안전하다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    // HttpException이 아니면 NestJS 기본 필터와 같은 응답 본문을 준다 —
    // 클라이언트가 보는 계약을 이 필터가 바꾸지 않는다.
    const body = isHttp
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    if (status >= 400) {
      const name =
        exception instanceof Error ? exception.constructor.name : 'unknown';
      const fields = extractFieldNames(body);
      const summary =
        `${request.method} ${request.path} → ${status} (${name})` +
        (fields ? ` fields=[${fields.join(',')}]` : '');

      if (status >= 500) {
        const stack = exception instanceof Error ? exception.stack : undefined;
        this.logger.error(summary, stack);
      } else {
        this.logger.warn(summary);
      }
    }

    httpAdapter.reply(ctx.getResponse(), body, status);
  }
}
