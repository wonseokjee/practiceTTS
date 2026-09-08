import { DataSource } from 'typeorm';
import {
  dayBucket,
  dayWindowStart,
  weekBucket,
  weekWindowStart,
} from './week-boundary';

/**
 * 주·일 경계식 **DB 통합 테스트** (REGRESSION, CRITICAL).
 *
 * ## 왜 유닛으로는 부족한가
 *
 * 유닛은 식의 **모양**만 본다. 그런데 이 변경에서 틀릴 수 있는 것은 모양이
 * 아니라 **Postgres가 그 식을 어떻게 해석하는가**다:
 *
 *  - `date_trunc('week')`가 정말 월요일에 자르는가
 *  - `AT TIME ZONE`을 씌운 뒤에도 그러한가
 *  - 하루 밀어 자르고 되돌리면 정말 일요일에 서는가
 *  - 창의 하한과 버킷의 기준점이 정말 같은가
 *
 * 넷 다 **Postgres만 안다.** 그리고 틀려도 숫자가 그럴듯하게 나와서, 보호자는
 * 잘못된 주간 리포트를 보고도 알 수가 없다.
 *
 * ## 기대값을 어디서 얻는가
 *
 * Postgres에게 물어 그 답을 그대로 기대값으로 쓰면 아무것도 검증하지 못한다.
 * 그래서 **JS로 독립 계산해 교차 검증**한다 — 두 구현이 같은 답을 내야 한다.
 *
 * ## 쓰기를 하지 않는다
 *
 * 상수 timestamptz에 식을 적용해 물어보기만 한다. dev DB에 행을 남기지 않아
 * 반복 실행이 안전하다.
 */

/** 그 시각을 해당 타임존의 벽시계 날짜(YYYY-MM-DD)로. */
function localYmd(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 그 시각의 해당 타임존 요일 (0=일 … 6=토). */
function localDow(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(instant);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** JS로 계산한 주 시작일 — Postgres 답과 대조할 독립 구현. */
function expectedWeekStartYmd(
  instant: Date,
  timeZone: string,
  weekStart: number,
): string {
  const ymd = localYmd(instant, timeZone);
  const dow = localDow(instant, timeZone);
  const back = (dow - weekStart + 7) % 7;
  const [y, m, d] = ymd.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d - back));
  return shifted.toISOString().slice(0, 10);
}

describe('week-boundary (DB 통합)', () => {
  let ds: DataSource | null = null;

  beforeAll(async () => {
    const candidate = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      entities: [],
      synchronize: false,
    });
    try {
      ds = await candidate.initialize();
    } catch {
      ds = null;
      console.warn(
        '[week-boundary 통합] DB에 연결하지 못해 건너뛴다. ' +
          'dev DB가 있으면 이 테스트가 경계식을 실제로 검증한다.',
      );
    }
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const itDb = (name: string, fn: () => Promise<void>): void => {
    it(name, async () => {
      if (!ds) return;
      await fn();
    });
  };

  /** 식 하나를 상수 timestamptz에 적용해 Postgres에게 물어본다. */
  async function evalBucket(
    exprFor: (col: string) => string,
    iso: string,
  ): Promise<string> {
    const expr = exprFor(`'${iso}'::timestamptz`);
    const rows: { v: string }[] = await ds!.query(
      `SELECT to_char(${expr}, 'YYYY-MM-DD') AS v`,
    );
    return rows[0].v;
  }

  // 이 순간은 두 지역에서 **날짜도 요일도 다르다** — 서울은 월요일, LA는 일요일.
  const ACROSS_MIDNIGHT = '2026-09-07T02:00:00Z';

  describe('타임존', () => {
    itDb(
      '서버 TZ가 아니라 환자 TZ로 자른다 — 같은 순간이 다른 주에 묶인다',
      async () => {
        const seoul = await evalBucket(
          (c) => weekBucket(c, 'Asia/Seoul', 1),
          ACROSS_MIDNIGHT,
        );
        const la = await evalBucket(
          (c) => weekBucket(c, 'America/Los_Angeles', 1),
          ACROSS_MIDNIGHT,
        );
        expect(seoul).not.toBe(la);
      },
    );

    itDb(
      '일 버킷도 환자 TZ를 따른다 — 미국 환자의 오늘이 KST 자정에 안 잘린다',
      async () => {
        const instant = new Date(ACROSS_MIDNIGHT);
        const seoul = await evalBucket(
          (c) => dayBucket(c, 'Asia/Seoul'),
          ACROSS_MIDNIGHT,
        );
        const la = await evalBucket(
          (c) => dayBucket(c, 'America/Los_Angeles'),
          ACROSS_MIDNIGHT,
        );
        expect(seoul).toBe(localYmd(instant, 'Asia/Seoul'));
        expect(la).toBe(localYmd(instant, 'America/Los_Angeles'));
        expect(seoul).not.toBe(la);
      },
    );
  });

  describe('주 시작 요일 — Postgres와 JS가 같은 답을 내야 한다', () => {
    const instants = [
      '2026-09-07T02:00:00Z',
      '2026-09-06T14:00:00Z',
      '2026-01-01T00:30:00Z',
      '2026-03-08T10:00:00Z', // 미국 서머타임 시작 주
      '2026-11-01T09:00:00Z', // 미국 서머타임 종료 주
    ];
    const zones = ['Asia/Seoul', 'America/Los_Angeles', 'UTC'];

    for (const weekStart of [0, 1, 6]) {
      itDb(`주 시작 ${weekStart}(0=일)에서 모든 표본이 일치한다`, async () => {
        for (const iso of instants) {
          for (const tz of zones) {
            const fromPg = await evalBucket(
              (c) => weekBucket(c, tz, weekStart),
              iso,
            );
            const fromJs = expectedWeekStartYmd(new Date(iso), tz, weekStart);
            expect(`${tz} ${iso} -> ${fromPg}`).toBe(
              `${tz} ${iso} -> ${fromJs}`,
            );
          }
        }
      });
    }

    itDb('일요일 시작이면 경계가 정말 일요일에 선다', async () => {
      const ymd = await evalBucket(
        (c) => weekBucket(c, 'America/Los_Angeles', 0),
        ACROSS_MIDNIGHT,
      );
      const rows: { dow: string }[] = await ds!.query(
        `SELECT EXTRACT(DOW FROM '${ymd}'::date)::text AS dow`,
      );
      expect(rows[0].dow).toBe('0');
    });

    itDb('월요일 시작이면 경계가 정말 월요일에 선다', async () => {
      const ymd = await evalBucket(
        (c) => weekBucket(c, 'America/Los_Angeles', 1),
        ACROSS_MIDNIGHT,
      );
      const rows: { dow: string }[] = await ds!.query(
        `SELECT EXTRACT(DOW FROM '${ymd}'::date)::text AS dow`,
      );
      expect(rows[0].dow).toBe('1');
    });
  });

  describe('창의 하한과 버킷의 기준점이 같다', () => {
    // 이게 어긋나면 첫 주·마지막 주가 반쪽 데이터가 된다 — 계획서가 지목한
    // "틀려도 숫자가 그럴듯하게 나오는" 실패다.
    const DAY_MS = 24 * 60 * 60 * 1000;

    for (const weekStart of [0, 1]) {
      itDb(
        `주 시작 ${weekStart}: 하한이 정확히 N주 전 주 시작과 같다`,
        async () => {
          const tz = 'America/Los_Angeles';
          const weeksBack = 7;
          const lowerExpr = weekWindowStart(tz, weekStart, weeksBack);
          const bucketExpr = weekBucket('now()', tz, weekStart);
          const rows: { lower: string; bucketNow: string }[] = await ds!.query(
            `SELECT to_char(${lowerExpr} AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS lower,
                  to_char(${bucketExpr}, 'YYYY-MM-DD') AS "bucketNow"`,
          );
          const lower = new Date(`${rows[0].lower}T00:00:00Z`);
          const bucketNow = new Date(`${rows[0].bucketNow}T00:00:00Z`);
          expect((bucketNow.getTime() - lower.getTime()) / DAY_MS).toBe(
            weeksBack * 7,
          );
        },
      );
    }

    itDb('일 창의 하한도 일 버킷과 정확히 N일 차이다', async () => {
      const tz = 'America/Los_Angeles';
      const daysBack = 14;
      const lowerExpr = dayWindowStart(tz, daysBack);
      const bucketExpr = dayBucket('now()', tz);
      const rows: { lower: string; bucketNow: string }[] = await ds!.query(
        `SELECT to_char(${lowerExpr} AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS lower,
                to_char(${bucketExpr}, 'YYYY-MM-DD') AS "bucketNow"`,
      );
      const lower = new Date(`${rows[0].lower}T00:00:00Z`);
      const bucketNow = new Date(`${rows[0].bucketNow}T00:00:00Z`);
      expect((bucketNow.getTime() - lower.getTime()) / DAY_MS).toBe(daysBack);
    });
  });
});
