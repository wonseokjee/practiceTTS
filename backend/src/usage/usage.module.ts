import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyCapGuard } from './daily-cap.guard';
import { DailyGenerationUsage } from './entities/daily-generation-usage.entity';
import { GenerationUsageService } from './generation-usage.service';

/**
 * 일일 생성 상한. 생성 경로가 있는 모듈(memory·quiz·training)이 import해
 * `@UseGuards(DailyCapGuard) @DailyCap('<kind>')`로 쓴다.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DailyGenerationUsage])],
  providers: [GenerationUsageService, DailyCapGuard],
  exports: [GenerationUsageService, DailyCapGuard],
})
export class UsageModule {}
