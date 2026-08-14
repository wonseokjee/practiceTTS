import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import type { QabSubtest } from '../constants/qab-subtest';

/**
 * 환자별×스킬(QAB 서브테스트)별 현재 난이도 레벨(1~5).
 *
 * 파생 상태다: 값 자체는 매 제출마다 현재 레벨에서 제시된 최근 윈도우
 * 정확도로 재계산된다(skill-leveling.ts). 그래서 (patient_id, subtest)당
 * 1행만 두고 UPSERT한다. 이력이 없는 스킬은 이 테이블에 행이 없으며,
 * 조회 시 콜드스타트 레벨(2)로 채운다.
 */
@Entity('skill_levels')
@Index('UQ_skill_levels_patient_subtest', ['patientId', 'subtest'], { unique: true })
@Check('CHK_skill_levels_level_range', '"level" >= 1 AND "level" <= 5')
export class SkillLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id', foreignKeyConstraintName: 'FK_skill_levels_patient' })
  patient: User;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'subtest', type: 'varchar', length: 16 })
  subtest: QabSubtest;

  @Column({ name: 'level', type: 'smallint', default: 2 })
  level: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
