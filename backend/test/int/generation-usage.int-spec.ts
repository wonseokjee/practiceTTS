import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { DAILY_GENERATION_CAPS } from '../../src/usage/daily-generation-caps';
import { GenerationUsageService } from '../../src/usage/generation-usage.service';
import { openTestDataSource } from './test-database';

/**
 * 일일 생성 카운터를 실제 Postgres에서 — 원자성은 mock으로 증명할 수 없다.
 *
 * 인메모리 레이트리밋이 재시작마다 0이 되던 문제(OV-4A)를 DB 카운터로 옮기면서
 * 새로 생기는 위험은 경합이다: "읽고 → 비교하고 → 쓰는" 식이면 동시 요청이 같은
 * 값을 읽어 상한을 함께 넘는다. 한 문장 upsert라 그럴 수 없다는 걸 여기서 본다.
 */
describe('GenerationUsageService (DB)', () => {
  let ds: DataSource;
  let usage: GenerationUsageService;

  const patient = async (timezone = 'Asia/Seoul'): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name, timezone) VALUES ($1, 'patient', 'p', $2)`,
      [id, timezone],
    );
    return id;
  };

  const storedDays = async (
    patientId: string,
  ): Promise<{ day: string; kind: string; count: number }[]> =>
    ds.query(
      `SELECT day::text AS day, kind, count FROM daily_generation_usage
       WHERE patient_id = $1 ORDER BY day, kind`,
      [patientId],
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
    usage = new GenerationUsageService(ds);
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users CASCADE');
    await ds.destroy();
  });

  it('호출마다 1씩 오르고, 종류별로 따로 센다', async () => {
    const p = await patient();
    const at = new Date('2026-10-27T03:00:00Z');

    const counts = [
      (await usage.consume(p, 'quiz', at)).count,
      (await usage.consume(p, 'quiz', at)).count,
      (await usage.consume(p, 'scenario', at)).count,
    ];

    expect(counts).toEqual([1, 2, 1]);
  });

  it('동시 요청이 같은 값을 보지 않는다 — 상한+1개를 한꺼번에 보내면 정확히 상한만 통과', async () => {
    const p = await patient();
    const at = new Date('2026-10-27T03:00:00Z');
    const cap = DAILY_GENERATION_CAPS.memory;

    const decisions = await Promise.all(
      Array.from({ length: cap + 1 }, () => usage.consume(p, 'memory', at)),
    );

    const counts = decisions.map((d) => d.count).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: cap + 1 }, (_, i) => i + 1));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(cap);
    expect(decisions.find((d) => !d.allowed)?.count).toBe(cap + 1);
  });

  it('하루는 환자 로컬 자정에 바뀐다 — 서울', async () => {
    const p = await patient('Asia/Seoul');

    // 10-27 23:59 KST, 10-28 00:01 KST
    const late = await usage.consume(
      p,
      'quiz',
      new Date('2026-10-27T14:59:00Z'),
    );
    const early = await usage.consume(
      p,
      'quiz',
      new Date('2026-10-27T15:01:00Z'),
    );

    expect([late.count, early.count]).toEqual([1, 1]);
    expect(late.retryAfterSeconds).toBe(60);
    expect(await storedDays(p)).toEqual([
      { day: '2026-10-27', kind: 'quiz', count: 1 },
      { day: '2026-10-28', kind: 'quiz', count: 1 },
    ]);
  });

  it('하루는 환자 로컬 자정에 바뀐다 — LA (서버·UTC 날짜가 아니다)', async () => {
    const p = await patient('America/Los_Angeles');

    // 10-26 23:59 PDT = UTC로는 이미 10-27
    const d = await usage.consume(
      p,
      'conversation',
      new Date('2026-10-27T06:59:00Z'),
    );

    expect(d.retryAfterSeconds).toBe(60);
    expect(await storedDays(p)).toEqual([
      { day: '2026-10-26', kind: 'conversation', count: 1 },
    ]);
  });
});
