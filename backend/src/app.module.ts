import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { MemoryModule } from './memory/memory.module';
import { TrainingModule } from './training/training.module';

@Module({
  imports: [
    // 환경변수를 전역으로 사용 가능하게 설정
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    MemoryModule,
    TrainingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
