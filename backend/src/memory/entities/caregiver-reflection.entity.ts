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
import { DiaryQuestion } from './diary-question.entity';
import { MemoryEntry } from './memory-entry.entity';

/**
 * 보호자 본인의 "나의 하루" 사적 답변
 * - isPrivate=true 기본값 강제 (서비스 레이어에서도 항상 true로 저장)
 * - **응답 DTO 직렬화 / LLM 입력 화이트리스트 어디서도 노출 금지**
 * - questionId FK는 ON DELETE RESTRICT (시드 질문이 사라지면 dangling 발생 방지, soft-delete 권장)
 */
@Entity('caregiver_reflections')
@Index('IDX_caregiver_reflections_caregiver_created', [
  'caregiverId',
  'createdAt',
])
@Index('IDX_caregiver_reflections_memory_entry', ['memoryEntryId'])
export class CaregiverReflection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 연결된 메모리 엔트리
  @ManyToOne(() => MemoryEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memory_entry_id', foreignKeyConstraintName: 'FK_caregiver_reflections_memory_entry' })
  memoryEntry: MemoryEntry;

  @Column({ name: 'memory_entry_id', type: 'uuid' })
  memoryEntryId: string;

  // 답변을 작성한 보호자
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caregiver_id', foreignKeyConstraintName: 'FK_caregiver_reflections_caregiver' })
  caregiver: User;

  @Column({ name: 'caregiver_id', type: 'uuid' })
  caregiverId: string;

  // 답변이 향한 질문 (정적 풀)
  @ManyToOne(() => DiaryQuestion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'question_id', foreignKeyConstraintName: 'FK_caregiver_reflections_question' })
  question: DiaryQuestion;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  // 답변 본문 (DTO에서 1~300자 강제)
  @Column({ name: 'answer_text', type: 'text' })
  answerText: string;

  // 사적 답변 여부 — 본 엔티티는 무조건 true
  @Column({ name: 'is_private', type: 'boolean', default: true })
  isPrivate: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
