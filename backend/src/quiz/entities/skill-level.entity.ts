import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import type { QabSubtest } from '../constants/qab-subtest';

/**
 * 환자별×스킬(QAB 서브테스트)별 현재 난이도 레벨(1~5).
 *
 * **세션 사이를 잇는 값**이다. 판정은 세션 안에서 문항 단위로 일어나고(프론트
 * `domain/sessionAdaptation.ts`), 세션이 끝나면 도달한 값이 여기 저장돼 다음
 * 세션의 시작 눈높이가 된다. 서버는 저장된 값에서 ±1을 벗어난 보고를 접는다.
 *
 * 예전에는 매 제출마다 최근 10시행 정확도로 재계산했는데, 실측 판정 지연이
 * 검사당 5~11세션이라 능력이 아니라 컨디션 노이즈를 학습했다(D7).
 *
 * (patient_id, subtest)당 1행만 두고 UPSERT한다. 이력이 없는 스킬은 행이 없으며
 * 조회 시 콜드스타트 레벨(2)로 채운다.
 */
@Entity('skill_levels')
// M18은 이걸 UNIQUE **제약**으로 만든다. 여기서 유니크 **인덱스**로 선언하면
// 이름은 같아도 다른 DB 객체라 드리프트로 잡힌다 — 마이그레이션 쪽에 맞춘다.
// (저장소 다수 관례는 CREATE UNIQUE INDEX이지만, 이미 배포됐을 수 있는
//  마이그레이션을 고치는 것보다 엔티티를 맞추는 쪽이 위험이 없다.)
@Unique('UQ_skill_levels_patient_subtest', ['patientId', 'subtest'])
@Check('CHK_skill_levels_level_range', '"level" >= 1 AND "level" <= 5')
export class SkillLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_skill_levels_patient',
  })
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
