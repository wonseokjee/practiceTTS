import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 사용자 역할 정의
export type UserRole = 'caregiver' | 'patient' | 'therapist';

// 로그인 제공자. 'local'=이메일/비밀번호, 그 외=소셜.
export type AuthProvider = 'local' | 'kakao' | 'google';

// (provider, provider_user_id) 부분 고유 인덱스. 마이그레이션(M13)과 동일하게
// 엔티티에도 선언해야 dev synchronize와 prod 마이그레이션이 어긋나지 않는다.
// 이 인덱스가 findOrCreateSocialUser의 동시 최초 로그인 경합 방어를 받친다.
@Index('UQ_users_provider_account', ['authProvider', 'providerUserId'], {
  unique: true,
  where: '"provider_user_id" IS NOT NULL',
})
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 소셜 로그인은 이메일을 안 줄 수 있어(카카오는 동의 선택) nullable.
  // NULL은 Postgres UNIQUE에 걸리지 않아 이메일 없는 소셜 유저가 공존한다.
  @Column({ unique: true, nullable: true, type: 'varchar' })
  email: string | null;

  // 비밀번호 해시는 기본적으로 조회 제외 (보안). 소셜 유저는 없음(NULL).
  @Column({
    name: 'password_hash',
    select: false,
    type: 'varchar',
    nullable: true,
  })
  passwordHash: string | null;

  // 로그인 제공자. 기존 계정은 마이그레이션 기본값 'local'.
  @Column({
    name: 'auth_provider',
    type: 'varchar',
    length: 20,
    default: 'local',
  })
  authProvider: AuthProvider;

  // 소셜 제공자가 준 그 계정의 고유 ID(카카오 회원번호 등). 재방문 매칭 키.
  // (auth_provider, provider_user_id)에 부분 고유 인덱스.
  @Column({ name: 'provider_user_id', type: 'varchar', nullable: true })
  providerUserId: string | null;

  @Column({ type: 'varchar', length: 20 })
  role: UserRole;

  @Column({ name: 'display_name' })
  displayName: string;

  // 보호자(caregiver)가 연결된 환자의 ID (nullable)
  @Column({ name: 'patient_id', type: 'uuid', nullable: true })
  patientId: string | null;

  // 연결된 환자 엔티티 참조 (자기 참조 관계)
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_users_patient',
  })
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
