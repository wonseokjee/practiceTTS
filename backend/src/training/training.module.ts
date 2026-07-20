import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { CryptoModule } from '../common/crypto.module';
import { ProfileModule } from '../profile/profile.module';
import { ConversationLog } from './entities/conversation-log.entity';
import { TrainingSession } from './entities/training-session.entity';
import { FastApiChatClientService } from './services/fast-api-chat-client.service';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

/**
 * 훈련 세션 모듈
 * - TrainingSession, ConversationLog 엔티티 등록
 * - MemoryEntry를 읽기 위해 직접 forFeature에 추가
 * - CryptoService: CryptoModule에서 공유받는다(인스턴스 1개).
 * - HttpModule: FastApiChatClientService의 HttpService 의존성 충족
 * - AuthModule: JwtAuthGuard 재사용
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TrainingSession, ConversationLog, MemoryEntry]),
    HttpModule,
    AuthModule,
    ProfileModule,
    CryptoModule,
  ],
  controllers: [TrainingController],
  providers: [
    TrainingService,
    FastApiChatClientService,
  ],
})
export class TrainingModule {}
