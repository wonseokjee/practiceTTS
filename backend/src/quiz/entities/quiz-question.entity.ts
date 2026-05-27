import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { QuizQuestionType } from '../constants/quiz-question-type';
import { QuizSet } from './quiz-set.entity';

/**
 * 퀴즈 셋에 속하는 단일 문제
 * - choices는 multiple_choice일 때만 string[] (jsonb)
 * - hintFirstChar는 fill_blank 전용
 * - explanation은 Phase 2 LLM 확장 컬럼 (Phase 1은 사전 확보만, 항상 null)
 */
@Entity('quiz_questions')
@Unique('UQ_quiz_questions_set_order', ['quizSetId', 'orderIndex'])
@Index('IDX_quiz_questions_set', ['quizSetId'])
export class QuizQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => QuizSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quiz_set_id' })
  quizSet: QuizSet;

  @Column({ name: 'quiz_set_id', type: 'uuid' })
  quizSetId: string;

  // 0..4 (5문제 기준)
  @Column({ name: 'order_index', type: 'int' })
  orderIndex: number;

  // 'multiple_choice' | 'yes_no' | 'fill_blank'
  @Column({ type: 'varchar', length: 16 })
  type: QuizQuestionType;

  @Column({ type: 'text' })
  prompt: string;

  // multiple_choice: string[] / 그 외: null
  @Column({ type: 'jsonb', nullable: true })
  choices: string[] | null;

  // 채점용 정답 (Phase 3 DTO 매퍼에서 클라이언트 응답으로부터 제외 또는 마스킹)
  @Column({ name: 'correct_answer', type: 'text' })
  correctAnswer: string;

  // fill_blank 전용 힌트 (정답의 첫 글자, 최대 8자)
  @Column({
    name: 'hint_first_char',
    type: 'varchar',
    length: 8,
    nullable: true,
  })
  hintFirstChar: string | null;

  // Phase 2 LLM 확장용 (Phase 1은 항상 null)
  @Column({ type: 'text', nullable: true })
  explanation: string | null;
}
