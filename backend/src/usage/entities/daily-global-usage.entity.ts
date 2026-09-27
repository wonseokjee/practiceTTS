import { Check, Column, Entity, PrimaryColumn } from 'typeorm';
import type { GlobalCapKind } from '../daily-global-caps';

/**
 * UTC 날짜 × 종류마다 한 행 — 서비스 전체 합계 카운터. M31과 글자 그대로 맞춘다.
 * 어긋나면 `schema:log`가 드리프트를 보고한다(통합 테스트 레인이 잡는다).
 *
 * 쓰기는 `GlobalUsageService.consume`의 원자적 upsert 한 곳뿐이다.
 */
@Entity('daily_global_usage')
@Check(
  'CHK_daily_global_usage_kind',
  `"kind" IN ('memory', 'quiz', 'scenario', 'conversation', 'stt', 'pronunciation', 'tts')`,
)
export class DailyGlobalUsage {
  @PrimaryColumn({
    name: 'day',
    type: 'date',
    primaryKeyConstraintName: 'PK_daily_global_usage',
  })
  day: string;

  @PrimaryColumn({
    name: 'kind',
    type: 'varchar',
    length: 16,
    primaryKeyConstraintName: 'PK_daily_global_usage',
  })
  kind: GlobalCapKind;

  @Column({ name: 'count', type: 'integer', default: 0 })
  count: number;
}
