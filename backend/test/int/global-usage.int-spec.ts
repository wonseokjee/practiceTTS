import { DataSource } from 'typeorm';
import { GLOBAL_DAILY_CAPS } from '../../src/usage/daily-global-caps';
import { GlobalUsageService } from '../../src/usage/global-usage.service';
import { openTestDataSource } from './test-database';

/**
 * 서비스 전체 일일 카운터를 실제 Postgres에서 — 원자성은 mock으로 증명할 수 없다.
 *
 * 이 카운터는 **모든 사용자가 한 행을 같이 올린다**(가구별 카운터와 달리 행 경합이 본질이다).
 * "읽고 → 비교하고 → 쓰는" 식이면 동시 요청이 같은 값을 읽어 상한을 함께 넘는다. 한 문장
 * upsert라 그럴 수 없다는 걸 여기서 본다. 하루는 UTC 자정에 바뀐다(환자 로컬이 아니다).
 */
describe('GlobalUsageService (DB)', () => {
  let ds: DataSource;
  let usage: GlobalUsageService;

  const stored = async (): Promise<
    { day: string; kind: string; count: number }[]
  > =>
    ds.query(
      `SELECT day::text AS day, kind, count FROM daily_global_usage ORDER BY day, kind`,
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
    usage = new GlobalUsageService(ds);
  });

  beforeEach(async () => {
    await ds.query('TRUNCATE daily_global_usage');
  });

  afterAll(async () => {
    await ds.query('TRUNCATE daily_global_usage');
    await ds.destroy();
  });

  it('호출마다 1씩 오르고, 종류별로 따로 센다', async () => {
    const at = new Date('2026-10-27T03:00:00Z');

    const counts = [
      (await usage.consume('stt', at)).count,
      (await usage.consume('stt', at)).count,
      (await usage.consume('tts', at)).count,
    ];

    expect(counts).toEqual([1, 2, 1]);
    expect(await stored()).toEqual([
      { day: '2026-10-27', kind: 'stt', count: 2 },
      { day: '2026-10-27', kind: 'tts', count: 1 },
    ]);
  });

  it('상한 안은 통과, 상한 다음 호출부터 거절 — 거절된 호출도 센다', async () => {
    const at = new Date('2026-10-27T03:00:00Z');
    const cap = GLOBAL_DAILY_CAPS.memory;

    let last = await usage.consume('memory', at);
    for (let i = 1; i < cap; i++) last = await usage.consume('memory', at);
    expect(last).toMatchObject({ allowed: true, count: cap, limit: cap });

    const over = await usage.consume('memory', at);
    expect(over).toMatchObject({ allowed: false, count: cap + 1 });
    expect((await usage.consume('memory', at)).count).toBe(cap + 2);
  });

  it('동시 요청이 같은 값을 보지 않는다 — 상한+1개를 한꺼번에 보내면 정확히 상한만 통과', async () => {
    const at = new Date('2026-10-27T03:00:00Z');
    const cap = GLOBAL_DAILY_CAPS.memory;

    const decisions = await Promise.all(
      Array.from({ length: cap + 1 }, () => usage.consume('memory', at)),
    );

    const counts = decisions.map((d) => d.count).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: cap + 1 }, (_, i) => i + 1));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(cap);
    expect(decisions.find((d) => !d.allowed)?.count).toBe(cap + 1);
  });

  it('하루는 UTC 자정에 바뀐다 — 서울 자정(UTC 15:00)에는 바뀌지 않는다', async () => {
    const beforeUtcMidnight = new Date('2026-10-27T23:59:59Z');
    const afterUtcMidnight = new Date('2026-10-28T00:00:01Z');
    const seoulMidnight = new Date('2026-10-27T15:00:01Z'); // 10-28 00:00 KST

    await usage.consume('quiz', beforeUtcMidnight);
    await usage.consume('quiz', seoulMidnight);
    const next = await usage.consume('quiz', afterUtcMidnight);

    expect(next.count).toBe(1); // 새 UTC 날짜라 다시 1부터
    expect(await stored()).toEqual([
      { day: '2026-10-27', kind: 'quiz', count: 2 },
      { day: '2026-10-28', kind: 'quiz', count: 1 },
    ]);
  });

  it('Retry-After는 다음 UTC 자정까지 남은 초', async () => {
    const decision = await usage.consume(
      'tts',
      new Date('2026-10-27T23:00:00Z'),
    );
    expect(decision.retryAfterSeconds).toBe(3600);
  });

  it('스키마가 허용하지 않는 종류는 DB가 거절한다(CHECK)', async () => {
    await expect(
      ds.query(
        `INSERT INTO daily_global_usage (day, kind, count) VALUES ('2026-10-27', 'bogus', 1)`,
      ),
    ).rejects.toThrow(/CHK_daily_global_usage_kind/);
  });
});
