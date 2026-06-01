import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { MemoryEntry } from '../../memory/entities/memory-entry.entity';
import { ConversationLog } from './conversation-log.entity';

/** 훈련 세션 상태 */
export type TrainingSessionStatus = 'active' | 'completed' | 'abandoned';

@Entity('training_sessions')
export class TrainingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 훈련 대상 환자
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  // 훈련에 사용된 메모리 엔트리
  @ManyToOne(() => MemoryEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memory_entry_id' })
  memoryEntry: MemoryEntry;

  @Column({ name: 'memory_entry_id', type: 'uuid' })
  memoryEntryId: string;

  // 세션 상태: active(진행중) | completed(완료) | abandoned(중단)
  @Column({
    type: 'varchar',
    length: 20,
    default: 'active',
  })
  status: TrainingSessionStatus;

  // 힌트 단계 (0: 힌트 없음, 1: 첫 음절 힌트, 2: 양자택일 폐쇄형 질문)
  @Column({ name: 'hint_level', type: 'int', default: 0 })
  hintLevel: number;

  // 훈련에 사용된 목표 단어 (nullable: 세션 생성 시점에 선택)
  @Column({ name: 'target_word_used', type: 'varchar', nullable: true })
  targetWordUsed: string | null;

  // 훈련 성공 여부 (completed 상태일 때만 의미 있음)
  @Column({ type: 'boolean', nullable: true })
  success: boolean | null;

  // 훈련 소요 시간 (밀리초), 완료 시 계산
  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  // 대화 로그 (OneToMany 관계)
  @OneToMany(() => ConversationLog, (log) => log.session)
  conversationLogs: ConversationLog[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
