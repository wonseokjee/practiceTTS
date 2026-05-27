import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuizAttempt } from './entities/quiz-attempt.entity';
import { QuizBestScore } from './entities/quiz-best-score.entity';
import { QuizQuestion } from './entities/quiz-question.entity';
import { QuizSet } from './entities/quiz-set.entity';

/**
 * Quiz 모듈 (Phase 1 골격)
 * - 4개 엔티티만 TypeORM에 등록 (synchronize=true 환경에서 스키마 자동 생성)
 * - Service/Controller는 Phase 3에서 추가
 * - 외부 노출 없음 (exports 비어있음)
 *
 * 의존 방향 (강제 규칙):
 *   QuizModule → MemoryModule  (Phase 3부터 허용)
 *   MemoryModule → QuizModule  (전 phase 금지)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuizSet,
      QuizQuestion,
      QuizAttempt,
      QuizBestScore,
    ]),
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class QuizModule {}
