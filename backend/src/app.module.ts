import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { MemoryModule } from './memory/memory.module';
import { QuizModule } from './quiz/quiz.module';
import { TrainingModule } from './training/training.module';

@Module({
  imports: [
    // 환경변수를 전역으로 사용 가능하게 설정
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    MemoryModule,
    TrainingModule,
    // Phase 1 골격 등록 (Service/Controller는 Phase 3에서 추가)
    QuizModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
