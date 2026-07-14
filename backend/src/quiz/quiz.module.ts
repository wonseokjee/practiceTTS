import { HttpModule } from '@nestjs/axios';
import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MemoryEntry } from '../memory/entities/memory-entry.entity';
import { PatientMemoryNote } from '../memory/entities/patient-memory-note.entity';
import { QabResult } from './entities/qab-result.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';
import { QUIZ_GENERATION_CLIENT } from './interfaces/IQuizGenerationClient';
import { QUIZ_SCORER } from './interfaces/IQuizScorer';
import { WISH_CONVERSION_CLIENT } from './interfaces/IWishConversionClient';
import { ProfileModule } from '../profile/profile.module';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { QuizGenerationClient } from './services/quiz-generation.client';
import { QuizGenerationListener } from './services/quiz-generation.listener';
import { QuizScorerService } from './services/quiz-scorer.service';
import { WishConversionClient } from './services/wish-conversion.client';

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
      QabResult,
      MemoryEntry,
      PatientMemoryNote,
    ]),
    HttpModule,
    AuthModule,
    // 퀴즈 생성 시 가족 실명·지명을 토큰화(LLM 노출 차단)하고 산출물을 역치환한다.
    ProfileModule,
  ],
  controllers: [QuizController],
  providers: [
    QuizService,
    QuizGenerationListener,
    { provide: QUIZ_GENERATION_CLIENT, useClass: QuizGenerationClient },
    { provide: QUIZ_SCORER, useClass: QuizScorerService },
    { provide: WISH_CONVERSION_CLIENT, useClass: WishConversionClient },
  ],
  exports: [],
})
export class QuizModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuizModule.name);

  constructor(private readonly quizService: QuizService) {}

  /**
   * 부팅 직후 고아 pending QuizSet을 복구한다 (이벤트 durability 보강).
   * - 이전 프로세스가 LLM 생성 중 죽어 'pending'에 박제된 set을 재시도.
   * - fire-and-forget: 복구 작업(LLM 호출 다수)이 앱 부팅을 막지 않도록 await하지 않는다.
   */
  onApplicationBootstrap(): void {
    void this.quizService.recoverStalePendingSets().catch((error) => {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.warn(`pending QuizSet 복구 작업 실패: ${message}`);
    });
  }
}
