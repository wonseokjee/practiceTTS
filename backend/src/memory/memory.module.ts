import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CaregiverReflection } from './entities/caregiver-reflection.entity';
import { DiaryQuestion } from './entities/diary-question.entity';
import { HealingMessage } from './entities/healing-message.entity';
import { MemoryEntry } from './entities/memory-entry.entity';
import { MoodEntry } from './entities/mood-entry.entity';
import { PatientMemoryNote } from './entities/patient-memory-note.entity';
import { MemoryController } from './memory.controller';
import { MemoryEntryService } from './memory.service';
import { CryptoService } from './services/crypto.service';
import { DiaryQuestionService } from './services/diary-question.service';
import { FastApiClientService } from './services/fast-api-client.service';
import { FileStorageService } from './services/file-storage.service';
import { HealingMessageService } from './services/healing-message.service';

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
  ],
  controllers: [MemoryController],
  providers: [
    MemoryEntryService,
    FastApiClientService,
    CryptoService,
    FileStorageService,
    DiaryQuestionService,
    HealingMessageService,
  ],
  exports: [MemoryEntryService, DiaryQuestionService, HealingMessageService],
})
export class MemoryModule {}
