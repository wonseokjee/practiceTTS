import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 환자 프로필 (환자당 1개)
 * - 보호자가 등록하는 환자의 배경 정보 (고향·직업·취미·의미있는 장소).
 * - notes는 PII 가능성이 있어 서비스 레이어에서 AES-256 암호화하여 저장한다.
 * - patientId UNIQUE (환자당 1개 보장).
 */
@Entity('patient_profiles')
@Index('UQ_patient_profiles_patient', ['patientId'], { unique: true })
export class PatientProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 프로필 대상 환자 (users.id)
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  // 등록·수정 권한을 가진 보호자 (users.id)
  @Column({ name: 'caregiver_id', type: 'uuid' })
  caregiverId: string;

  // 고향/주요 거주지 (예: "강릉")
  @Column({ name: 'hometown', type: 'varchar', length: 100, nullable: true })
  hometown: string | null;

  // 직업/평생 직업 (예: "교사")
  @Column({ name: 'occupation', type: 'varchar', length: 100, nullable: true })
  occupation: string | null;

  // 취미 목록
  @Column({ name: 'hobbies', type: 'jsonb', default: () => "'[]'" })
  hobbies: string[];

  // 의미 있는 장소 목록 (예: ["○○공원", "고향집"])
  @Column({ name: 'significant_places', type: 'jsonb', default: () => "'[]'" })
  significantPlaces: string[];

  // 자유 서술 배경 (AES-256 암호화 저장, PII 가능)
  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
