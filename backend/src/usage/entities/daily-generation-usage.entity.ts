import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import type { GenerationKind } from '../daily-generation-caps';

/**
 * 환자 × 환자 로컬 날짜 × 생성 종류마다 한 행. M30과 글자 그대로 맞춘다 —
 * 어긋나면 `schema:log`가 드리프트를 보고한다(통합 테스트 레인이 잡는다).
 *
 * 쓰기는 `GenerationUsageService.consume`의 원자적 upsert 한 곳뿐이다.
 */
@Entity('daily_generation_usage')
@Check(
  'CHK_daily_generation_usage_kind',
  `"kind" IN ('memory', 'quiz', 'scenario', 'conversation')`,
)
export class DailyGenerationUsage {
  @PrimaryColumn({
    name: 'patient_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_daily_generation_usage',
  })
  patientId: string;

  @PrimaryColumn({
    name: 'day',
    type: 'date',
    primaryKeyConstraintName: 'PK_daily_generation_usage',
  })
  day: string;

  @PrimaryColumn({
    name: 'kind',
    type: 'varchar',
    length: 16,
    primaryKeyConstraintName: 'PK_daily_generation_usage',
  })
  kind: GenerationKind;

  @Column({ name: 'count', type: 'integer', default: 0 })
  count: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_daily_generation_usage_patient',
  })
  patient: User;
}
