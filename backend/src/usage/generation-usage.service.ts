import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  assertTimezone,
  dayBucket,
  DEFAULT_TIMEZONE,
} from '../common/week-boundary';
import {
  DAILY_GENERATION_CAPS,
  type GenerationKind,
} from './daily-generation-caps';

export interface UsageDecision {
  allowed: boolean;
  /** 이번 호출까지 센 오늘 사용량. 거절된 호출도 포함한다. */
  count: number;
  limit: number;
  /** 환자 로컬 자정까지 남은 초 — 429의 Retry-After. */
  retryAfterSeconds: number;
}

/**
 * 일일 생성 사용량 — 올리고, 상한과 비교한다(실행 계획 §14 OV-A).
 *
 * ```
 *   users.timezone 읽기 ──▶ dayBucket(at, tz)::date  ← 보호자 화면의 "오늘"과 같은 식
 *          │
 *   INSERT (patient, day, kind, 1)
 *   ON CONFLICT DO UPDATE SET count = count + 1
 *   RETURNING count          ← 한 문장이라 동시 요청 둘이 같은 값을 못 본다
 *          │
 *   count ≤ 상한 ? 통과 : 429
 * ```
 *
 * 올린 뒤 비교하므로 거절된 호출도 센다. 이미 상한을 넘은 뒤라 결과는 같다.
 */
@Injectable()
export class GenerationUsageService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * @param at 기준 시각. 테스트가 날짜 경계를 고정할 수 있게 받는다.
   */
  async consume(
    patientId: string,
    kind: GenerationKind,
    at: Date = new Date(),
  ): Promise<UsageDecision> {
    const users: { timezone: string }[] = await this.dataSource.query(
      'SELECT timezone FROM users WHERE id = $1',
      [patientId],
    );
    const tz = assertTimezone(users[0]?.timezone ?? DEFAULT_TIMEZONE);
    const today = dayBucket('$3::timestamptz', tz);

    const rows: { count: number; retry_after: number }[] =
      await this.dataSource.query(
        `INSERT INTO daily_generation_usage (patient_id, day, kind, count)
         VALUES ($1, (${today})::date, $2, 1)
         ON CONFLICT (patient_id, day, kind)
         DO UPDATE SET count = daily_generation_usage.count + 1
         RETURNING count,
           ceil(extract(epoch from (
             ((${today} + interval '1 day') AT TIME ZONE '${tz}') - $3::timestamptz
           )))::int AS retry_after`,
        [patientId, kind, at.toISOString()],
      );

    const limit = DAILY_GENERATION_CAPS[kind];
    const { count, retry_after } = rows[0];
    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSeconds: Math.max(1, retry_after),
    };
  }
}
