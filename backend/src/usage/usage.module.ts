import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyCapGuard } from './daily-cap.guard';
import { DailyGenerationUsage } from './entities/daily-generation-usage.entity';
import { DailyGlobalUsage } from './entities/daily-global-usage.entity';
import { GenerationUsageService } from './generation-usage.service';
import { GlobalCapGuard } from './global-cap.guard';
import { GlobalUsageService } from './global-usage.service';

/**
 * 일일 생성 상한. 생성 경로가 있는 모듈(memory·quiz·training)이 import해
 * `@UseGuards(DailyCapGuard) @DailyCap('<kind>')`로 쓴다.
 * 서비스 전체 합계 상한(`GlobalCapGuard`)은 그 뒤에 `@GlobalCap('<kind>')`로 붙인다 —
 * ai-proxy(Azure 경로)는 가구별 상한 없이 이것만 쓴다.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DailyGenerationUsage, DailyGlobalUsage])],
  providers: [
    GenerationUsageService,
    DailyCapGuard,
    GlobalUsageService,
    GlobalCapGuard,
  ],
  exports: [
    GenerationUsageService,
    DailyCapGuard,
    GlobalUsageService,
    GlobalCapGuard,
  ],
})
export class UsageModule {}
