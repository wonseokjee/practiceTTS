import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProfileModule } from '../profile/profile.module';
import { CaregiverReflection } from './entities/caregiver-reflection.entity';
import { DiaryQuestion } from './entities/diary-question.entity';
import { HealingMessage } from './entities/healing-message.entity';
import { MemoryEntry } from './entities/memory-entry.entity';
import { MoodEntry } from './entities/mood-entry.entity';
import { PatientMemoryNote } from './entities/patient-memory-note.entity';
import { MemoryController } from './memory.controller';
import { MemoryPhotoController } from './memory-photo.controller';
import { MemoryPhotoService } from './services/memory-photo.service';
import { MemoryEntryService } from './memory.service';
import { CryptoModule } from '../common/crypto.module';
import { DiaryQuestionService } from './services/diary-question.service';
import { FastApiClientService } from './services/fast-api-client.service';
import { FileStorageService } from './services/file-storage.service';
import { HealingMessageService } from './services/healing-message.service';
import { UsageModule } from '../usage/usage.module';

/**
 * 메모리 엔트리 모듈 (Phase 1 확장)
 * - Phase 1에서 4개 신규 엔티티 등록:
 *   MoodEntry, CaregiverReflection, PatientMemoryNote, DiaryQuestion
 * - DiaryQuestionService 신설 (오늘의 질문 추출)
 * - HttpModule: FastApiClientService가 @nestjs/axios HttpService 사용
 * - AuthModule: JwtAuthGuard 재사용
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MemoryEntry,
      MoodEntry,
      CaregiverReflection,
      PatientMemoryNote,
      DiaryQuestion,
      HealingMessage,
    ]),
    HttpModule,
    AuthModule,
    ProfileModule,
    CryptoModule,
    // 기억 등록·시나리오의 일일 생성 상한(DailyCapGuard).
    UsageModule,
  ],
  controllers: [MemoryController, MemoryPhotoController],
  providers: [
    MemoryEntryService,
    FastApiClientService,
    FileStorageService,
    DiaryQuestionService,
    HealingMessageService,
    MemoryPhotoService,
  ],
  exports: [MemoryEntryService, DiaryQuestionService, HealingMessageService],
})
export class MemoryModule {}
