import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 사용자 역할 정의
export type UserRole = 'caregiver' | 'patient' | 'therapist';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  // 비밀번호 해시는 기본적으로 조회 제외 (보안)
  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 20 })
  role: UserRole;

  @Column({ name: 'display_name' })
  displayName: string;

  // 보호자(caregiver)가 연결된 환자의 ID (nullable)
  @Column({ name: 'patient_id', type: 'uuid', nullable: true })
  patientId: string | null;

  // 연결된 환자 엔티티 참조 (자기 참조 관계)
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'patient_id' })
  patient: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
