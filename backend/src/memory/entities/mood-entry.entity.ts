import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { MemoryEntry } from './memory-entry.entity';

/**
 * 보호자 본인의 무드 1~5 (1일 1회 권장)
 * - MemoryEntry와 1:1 (memoryEntryId UNIQUE)
 * - moodLevel은 CHECK(1..5) 제약으로 도메인 무결성 보장
 * - **응답 DTO 직렬화 / LLM 입력 화이트리스트 어디서도 노출 금지** (보호자 사적 데이터)
 */
@Entity('mood_entries')
@Unique('UQ_mood_entries_memory_entry', ['memoryEntryId'])
@Check('CHK_mood_entries_level_range', '"mood_level" BETWEEN 1 AND 5')
@Index('IDX_mood_entries_caregiver_recorded', ['caregiverId', 'recordedAt'])
export class MoodEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 연결된 메모리 엔트리 (1:1)
  @ManyToOne(() => MemoryEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memory_entry_id', foreignKeyConstraintName: 'FK_mood_entries_memory_entry' })
  memoryEntry: MemoryEntry;

  @Column({ name: 'memory_entry_id', type: 'uuid' })
  memoryEntryId: string;

  // 무드를 기록한 보호자
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caregiver_id', foreignKeyConstraintName: 'FK_mood_entries_caregiver' })
  caregiver: User;

  @Column({ name: 'caregiver_id', type: 'uuid' })
  caregiverId: string;

  // 1(매우 나쁨) ~ 5(매우 좋음)
  @Column({ name: 'mood_level', type: 'smallint' })
  moodLevel: number;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;
}
