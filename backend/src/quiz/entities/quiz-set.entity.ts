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
import { MemoryEntry } from '../../memory/entities/memory-entry.entity';
import { QuizGenerationStatus } from '../constants/quiz-generation-status';

/**
 * 1개 라이프로그(MemoryEntry)에서 생성되는 5문제 묶음
 * - Phase 1은 골격만 (Service/Controller 없음)
 * - UNIQUE(memoryEntryId)는 두지 않는다 — 재생성 정책은 Phase 3에서 결정
 */
@Entity('quiz_sets')
@Index('IDX_quiz_sets_patient_status_created', [
  'patientId',
  'generationStatus',
  'createdAt',
])
@Index('IDX_quiz_sets_memory_entry', ['memoryEntryId'])
export class QuizSet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 출처 라이프로그
  @ManyToOne(() => MemoryEntry, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memory_entry_id',
    foreignKeyConstraintName: 'FK_quiz_sets_memory_entry',
  })
  memoryEntry: MemoryEntry;

  @Column({ name: 'memory_entry_id', type: 'uuid' })
  memoryEntryId: string;

  // 환자 (퀴즈를 풀 대상)
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_quiz_sets_patient',
  })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  // 라이프로그를 등록한 보호자
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'caregiver_id',
    foreignKeyConstraintName: 'FK_quiz_sets_caregiver',
  })
  caregiver: User;

  @Column({ name: 'caregiver_id', type: 'uuid' })
  caregiverId: string;

  // 'pending' | 'ready' | 'failed' (애플리케이션 레벨 enum 검증)
  @Column({
    name: 'generation_status',
    type: 'varchar',
    length: 16,
    default: 'pending',
  })
  generationStatus: QuizGenerationStatus;

  // 생성 시도 횟수. 부팅 복구가 failed set을 재시도하되 무한 반복하지 않도록
  // 상한(MAX_GENERATION_ATTEMPTS)을 거는 근거가 된다.
  // 시도 '시작' 시점에 증가시켜, 생성 도중 프로세스가 죽어도 카운트가 남는다.
  @Column({ name: 'generation_attempts', type: 'smallint', default: 0 })
  generationAttempts: number;

  // 실패 시 사유 저장
  @Column({ name: 'generation_error', type: 'text', nullable: true })
  generationError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // generation_status='ready'로 전이된 시각
  @Column({ name: 'ready_at', type: 'timestamptz', nullable: true })
  readyAt: Date | null;
}
