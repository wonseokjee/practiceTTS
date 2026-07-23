import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { DiaryQuestion } from './diary-question.entity';
import { MemoryEntry } from './memory-entry.entity';

/**
 * 환자 관련 답변 ("환자분의 하루")
 * - **퀴즈 LLM 입력의 유일한 소스**
 * - 환자 공개용 DTO에 포함 가능 (퀴즈 풀이 화면 컨텍스트 카드)
 * - category 분류: activity(활동) / moment(순간) / context(맥락)
 */
@Entity('patient_memory_notes')
@Unique('UQ_patient_memory_notes_entry_order', ['memoryEntryId', 'orderIndex'])
@Index('IDX_patient_memory_notes_entry_cat', ['memoryEntryId', 'category'])
export class PatientMemoryNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 연결된 메모리 엔트리
  @ManyToOne(() => MemoryEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memory_entry_id', foreignKeyConstraintName: 'FK_patient_memory_notes_memory_entry' })
  memoryEntry: MemoryEntry;

  @Column({ name: 'memory_entry_id', type: 'uuid' })
  memoryEntryId: string;

  // 답변이 향한 질문 (정적 풀)
  @ManyToOne(() => DiaryQuestion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'question_id', foreignKeyConstraintName: 'FK_patient_memory_notes_question' })
  question: DiaryQuestion;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  // 'activity' | 'moment' | 'context' — VARCHAR(16) (애플리케이션 레벨 검증)
  @Column({ type: 'varchar', length: 16 })
  category: 'activity' | 'moment' | 'context';

  // 동일 라이프로그 내 순서 (0..N) — UNIQUE(memoryEntryId, orderIndex)
  @Column({ name: 'order_index', type: 'smallint' })
  orderIndex: number;

  // 답변 본문 (DTO에서 1~300자 강제)
  @Column({ name: 'answer_text', type: 'text' })
  answerText: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
