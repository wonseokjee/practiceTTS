import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { QuizSet } from './quiz-set.entity';

/**
 * 퀴즈 셋당 최고 점수 1행 (UPSERT 대상)
 * - UNIQUE(quizSetId)
 * - R3=(b): 0~100 점수 범위 — 애플리케이션 레벨 검증만, DB CHECK 미적용
 */
@Entity('quiz_best_scores')
@Unique('UQ_quiz_best_scores_set', ['quizSetId'])
@Index('IDX_quiz_best_scores_patient', ['patientId'])
export class QuizBestScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => QuizSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quiz_set_id', foreignKeyConstraintName: 'FK_quiz_best_scores_set' })
  quizSet: QuizSet;

  @Column({ name: 'quiz_set_id', type: 'uuid' })
  quizSetId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id', foreignKeyConstraintName: 'FK_quiz_best_scores_patient' })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  // 0..100 (애플리케이션 레벨 검증)
  @Column({ name: 'best_score', type: 'int' })
  bestScore: number;

  @Column({ name: 'best_session_token', type: 'uuid' })
  bestSessionToken: string;

  @CreateDateColumn({ name: 'achieved_at', type: 'timestamptz' })
  achievedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
