import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { QUIZ_GENERATION_CLIENT } from './interfaces/IQuizGenerationClient';
import { QUIZ_SCORER } from './interfaces/IQuizScorer';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { QuizGenerationClient } from './services/quiz-generation.client';
import { QuizGenerationListener } from './services/quiz-generation.listener';
import { QuizScorerService } from './services/quiz-scorer.service';

/**
 * Quiz 모듈 (Phase 3 구현 완료)
 *
 * 의존 방향 (강제 규칙):
 *   QuizModule → Memory(엔티티/타입)   허용
 *   MemoryModule → QuizModule          전 phase 금지
 *
 * 자동 트리거는 @nestjs/event-emitter 기반 이벤트 디커플링으로 구현한다.
 *   MemoryEntryService.create() → emit('memory-entry.created')
 *   QuizGenerationListener.@OnEvent → QuizService.generateForMemoryEntry()
 * (MemoryModule은 어떤 Quiz 심볼도 import하지 않는다.)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuizSet,
      QuizQuestion,
      QuizAttempt,
      QuizBestScore,
      MemoryEntry,
      PatientMemoryNote,
    ]),
    HttpModule,
    AuthModule,
  ],
  controllers: [QuizController],
  providers: [
    QuizService,
    QuizGenerationListener,
    { provide: QUIZ_GENERATION_CLIENT, useClass: QuizGenerationClient },
    { provide: QUIZ_SCORER, useClass: QuizScorerService },
  ],
  exports: [],
})
export class QuizModule {}
