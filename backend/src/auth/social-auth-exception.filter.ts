import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

/**
 * 소셜 콜백 전용 예외 필터.
 *
 * 문제: 콜백이 백엔드 단계에서 실패하면(CSRF state 불일치, 사용자의 동의 거부,
 * 키 미설정 등) NestJS 기본 응답은 localhost:3000/auth/...callback 위치의 원시
 * JSON 에러다. 사용자는 백엔드 URL에 갇혀 앱으로 돌아갈 길이 없다.
 *
 * 해결: 콜백에서 발생한 어떤 예외든 프론트 로그인 화면으로 리다이렉트한다.
 * 가드 단계(동의 거부)와 핸들러 단계(state 불일치)를 모두 덮는다. 실제 원인은
 * 서버 로그에 남겨 디버깅 가능하게 한다(민감정보는 남기지 않음).
 */
@Injectable()
@Catch()
export class SocialAuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('SocialAuth');

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const message =
      exception instanceof Error ? exception.message : String(exception);
    this.logger.warn(`소셜 콜백 실패 (${req.path}): ${message}`);

    const frontend =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    res.redirect(`${frontend}/login?error=social`);
  }
}
