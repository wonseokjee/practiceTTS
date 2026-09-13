import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../auth/entities/user.entity';
import { LocaleSettingsService } from './locale-settings.service';
import { SettingsController } from './settings.controller';

/**
 * 계정 설정(언어 — 이후 시간). `users` 행의 `locale`을 쓴다.
 * - AuthModule: JwtAuthGuard·OnboardingGuard 재사용.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [SettingsController],
  providers: [LocaleSettingsService],
})
export class SettingsModule {}
