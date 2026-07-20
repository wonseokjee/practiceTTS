import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AiProxyController } from './ai-proxy.controller';
import { RateLimitGuard } from '../common/rate-limit.guard';

/**
 * ai-service 음성 기능(/stt, /tts) 프록시 모듈.
 *
 * 브라우저가 ai-service를 직접 부르던 두 경로를 백엔드 뒤로 옮겨 JWT로 막는다.
 */
@Module({
  imports: [HttpModule, ConfigModule, AuthModule],
  controllers: [AiProxyController],
  // 싱글턴으로 등록해야 요청 사이에 카운터가 유지된다. 프로바이더로 두지
  // 않으면 인스턴스가 여러 개 생겨 한도가 사실상 배로 늘어날 수 있다.
  providers: [RateLimitGuard],
})
export class AiProxyModule {}
