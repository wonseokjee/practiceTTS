import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GLOBAL_DAILY_CAPS, type GlobalCapKind } from './daily-global-caps';

export interface GlobalUsageDecision {
  allowed: boolean;
  /** 이번 호출까지 센 오늘(UTC) 서비스 전체 사용량. 거절된 호출도 포함한다. */
  count: number;
  limit: number;
  /** 다음 UTC 자정까지 남은 초 — 429의 Retry-After. */
  retryAfterSeconds: number;
}

/** 다음 UTC 자정까지 남은 초(최소 1). */
export function secondsUntilNextUtcMidnight(at: Date): number {
  const next = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - at.getTime()) / 1000));
}

/**
 * 서비스 전체 일일 사용량 — 올리고, 상한과 비교한다.
 *
 * ```
 *   INSERT (UTC day, kind, 1)
 *   ON CONFLICT DO UPDATE SET count = count + 1
 *   RETURNING count          ← 한 문장이라 동시 요청 둘이 같은 값을 못 본다
 *          │
 *   count ≤ 상한 ? 통과 : 429
 * ```
 *
 * 가구별 `GenerationUsageService`와 같은 방식이다. 올린 뒤 비교하므로 거절된
 * 호출도 센다 — 이미 상한을 넘은 뒤라 결과는 같다.
 */
@Injectable()
export class GlobalUsageService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * @param at 기준 시각. 테스트가 날짜 경계를 고정할 수 있게 받는다.
   */
  async consume(
    kind: GlobalCapKind,
    at: Date = new Date(),
  ): Promise<GlobalUsageDecision> {
    const rows: { count: number }[] = await this.dataSource.query(
      `INSERT INTO daily_global_usage (day, kind, count)
       VALUES ((($1::timestamptz) AT TIME ZONE 'UTC')::date, $2, 1)
       ON CONFLICT (day, kind)
       DO UPDATE SET count = daily_global_usage.count + 1
       RETURNING count`,
      [at.toISOString(), kind],
    );

    const limit = GLOBAL_DAILY_CAPS[kind];
    const { count } = rows[0];
    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSeconds: secondsUntilNextUtcMidnight(at),
    };
  }
}
