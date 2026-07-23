import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiProxyModule } from './ai-proxy/ai-proxy.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { MemoryModule } from './memory/memory.module';
import { seedDiaryQuestionsIfMissing } from './memory/seeds/diary-questions.seed';
import { seedHealingMessagesIfMissing } from './memory/seeds/healing-messages.seed';
import { ProfileModule } from './profile/profile.module';
import { QuizModule } from './quiz/quiz.module';
import { TrainingModule } from './training/training.module';
import { SingleInstanceGuard } from './common/single-instance.guard';

@Module({
  imports: [
    // 환경변수를 전역으로 사용 가능하게 설정
    ConfigModule.forRoot({ isGlobal: true }),
    // 모듈 간 이벤트 디커플링 (memory-entry.created → 퀴즈 자동 생성)
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AuthModule,
    AiProxyModule,
    MemoryModule,
    TrainingModule,
    ProfileModule,
    // Phase 3 구현 완료 (Controller/Service/이벤트 리스너 포함)
    QuizModule,
  ],
  controllers: [AppController],
  providers: [AppService, SingleInstanceGuard],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * 부트스트랩 시더 (계획서 §5-7).
   * 개발 환경(synchronize:true)에서도 diary_questions 풀이 비지 않도록 보장한다.
   * 멱등하므로 매 부팅 호출해도 안전하며, 운영 전환 시 마이그레이션 M4와 동일 의미.
   */
  async onModuleInit(): Promise<void> {
    const { inserted, skipped } = await seedDiaryQuestionsIfMissing(
      this.dataSource,
    );
    this.logger.log(
      `diary_questions 시드 적용 완료 (inserted=${inserted}, skipped=${skipped})`,
    );

    const healing = await seedHealingMessagesIfMissing(this.dataSource);
    this.logger.log(
      `healing_messages 시드 적용 완료 (inserted=${healing.inserted}, skipped=${healing.skipped})`,
    );
  }
}
