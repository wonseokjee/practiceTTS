import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AiProxyController } from './ai-proxy.controller';

/**
 * ai-service 음성 기능(/stt, /tts) 프록시 모듈.
 *
 * 브라우저가 ai-service를 직접 부르던 두 경로를 백엔드 뒤로 옮겨 JWT로 막는다.
 */
@Module({
  imports: [HttpModule, ConfigModule, AuthModule],
  controllers: [AiProxyController],
})
export class AiProxyModule {}
