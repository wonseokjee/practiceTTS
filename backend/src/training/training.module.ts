import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { CryptoService } from '../memory/services/crypto.service';
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
 * - CryptoService: MemoryModule을 import하는 대신 직접 provider로 등록
 *   (CryptoService는 ConfigService만 의존하므로 안전하게 재등록 가능)
 * - HttpModule: FastApiChatClientService의 HttpService 의존성 충족
 * - AuthModule: JwtAuthGuard 재사용
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TrainingSession, ConversationLog, MemoryEntry]),
    HttpModule,
    AuthModule,
    ProfileModule,
  ],
  controllers: [TrainingController],
  providers: [
    TrainingService,
    FastApiChatClientService,
    // CryptoService는 MemoryModule에서도 사용하므로 여기서 별도로 등록
    CryptoService,
  ],
})
export class TrainingModule {}
