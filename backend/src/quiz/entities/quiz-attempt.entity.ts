import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { QuizQuestion } from './quiz-question.entity';
import { QuizSet } from './quiz-set.entity';

/**
 * 환자의 문제별 응답 시도
 * - R5=(a): 무제한 재풀이 허용 → UNIQUE 제약 없음
 * - session_token: 클라이언트가 생성, 동일 5문제 풀이를 하나로 묶기 위함
 */
@Entity('quiz_attempts')
@Index('IDX_quiz_attempts_set_session', [
  'quizSetId',
  'sessionToken',
  'answeredAt',
])
@Index('IDX_quiz_attempts_patient_set', ['patientId', 'quizSetId'])
export class QuizAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => QuizSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quiz_set_id' })
  quizSet: QuizSet;

  @Column({ name: 'quiz_set_id', type: 'uuid' })
  quizSetId: string;

  @ManyToOne(() => QuizQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: QuizQuestion;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  // 클라이언트 생성 UUID — 5문제 동일 세션
  @Column({ name: 'session_token', type: 'uuid' })
  sessionToken: string;

  @Column({ name: 'user_answer', type: 'text' })
  userAnswer: string;

  @Column({ name: 'is_correct', type: 'boolean' })
  isCorrect: boolean;

  @CreateDateColumn({ name: 'answered_at' })
  answeredAt: Date;
}
