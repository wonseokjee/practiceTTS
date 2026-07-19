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
  @JoinColumn({ name: 'patient_id', foreignKeyConstraintName: 'FK_users_patient' })
  patient: User | null;

  // 환자 모드 복귀 PIN 해시 (보호자에만 설정). bcrypt 해시, 기본 조회 제외(보안).
  // 보호자 단일 계정 모델: 환자 모드에서 보호자로 돌아올 때 4자리 PIN 검증.
  @Column({
    name: 'patient_mode_pin_hash',
    type: 'varchar',
    nullable: true,
    select: false,
  })
  patientModePinHash: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
