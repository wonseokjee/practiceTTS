/**
 * 코호트 유지율 리포트 — 영어판 착수를 판정할 숫자를 읽는 도구.
 *
 * 영어판 Phase 1(i18n)·Phase 3(영어 문항)은 **한국 코호트의 이 리포트 수치**가
 * 전략 문서 ③절 기준을 넘은 뒤 착수한다(실행 계획 §13 OV-2A·8-2, §14 2-1A).
 * ③절은 아래 {@link RETENTION_METRICS}의 이름으로 기준을 적는다 — 이름을 바꾸면
 * 그 문서도 같이 고쳐야 한다.
 *
 * ## 무엇을 세나
 *
 * 단위는 **가구 = 환자 행 하나**다. 보호자와 환자는 각각 users 행이지만 주는
 * 환자의 타임존·주 시작 요일로 자른다(user.entity.ts `timezone` 주석).
 *
 *   환자 활동   : qab_results.answered_at · qab_session_completions.completed_at
 *   보호자 활동 : memory_entries.created_at · caregiver_reflections.created_at
 *                · mood_entries.recorded_at   (뒤 둘은 기억 기록의 patient_id로 잇는다)
 *
 * 보호자 활동을 `users.patient_id`가 아니라 **기억 기록의 patient_id**로 잇는
 * 이유: 보호자가 연결 환자를 바꿔도 과거 기록은 원래 가구에 남아야 한다.
 *
 * 코호트 = 환자 가입 주(환자 로컬). W_n = 가입 주에서 n주 뒤. **W_n이 다 지난
 * 가구만 분모에 넣는다** — 이번 주는 아직 끝나지 않았으니 비활성으로 세면 유지율이
 * 실제보다 낮게 나온다.
 *
 * ## 주 경계는 헬퍼 한 곳에서
 *
 * 경계식은 `src/common/week-boundary.ts`의 {@link weekBucket}만 쓴다. 이 리포트가
 * 따로 식을 가지면 보호자 화면의 주와 판정의 주가 어긋난다(계획 2-1A — 독립
 * `.sql`을 버린 이유). 헬퍼는 타임존을 SQL 리터럴로 받으므로, 환자들의
 * (timezone, week_start) 조합마다 한 번씩 질의한다.
 *
 * 실행:
 *   cd backend && npm run report:retention -- [--since=2026-10-01] [--weeks=8] [--json]
 *   --since : 이 날짜(UTC 0시) 이후 가입한 환자만. 출시 전 개발·시연 계정을 뺄 때.
 * (DB 접속은 src/database/data-source.ts 의 env를 그대로 사용)
 */
import { DataSource } from 'typeorm';
import {
  assertTimezone,
  assertWeekStart,
  weekBucket,
} from '../src/common/week-boundary';

/** ③절이 기준을 적는 이름들. 출력 순서이기도 하다. */
export const RETENTION_METRICS = [
  'patient_w1_retention',
  'patient_w4_retention',
  'caregiver_w1_retention',
  'caregiver_w4_retention',
  'household_w4_retention',
  'sessions_per_active_week_median',
] as const;

export type RetentionMetric = (typeof RETENTION_METRICS)[number];

export interface MetricValue {
  /** 비율이면 0~1, 중앙값이면 회수. 분모가 0이면 null — 0%와 "아직 모름"은 다르다. */
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface CohortRow {
  /** 가입 주 시작일(환자 로컬). 타임존·주 시작이 다르면 라벨도 다르다. */
  cohortWeek: string;
  households: number;
  /** 인덱스 n = W_n. 분모 0(아직 안 지남)이면 null. */
  patient: (number | null)[];
  caregiver: (number | null)[];
}

export interface RetentionReport {
  now: string;
  since: string | null;
  weeks: number;
  households: number;
  cohorts: CohortRow[];
  metrics: Record<RetentionMetric, MetricValue>;
}

export interface RetentionOptions {
  /** 기준 시각. 테스트가 고정할 수 있게 인자로 받는다(`now()`를 SQL에 박지 않는다). */
  now: Date;
  since?: Date | null;
  /** 코호트 표에 보일 W0..W(weeks) 칸 수. */
  weeks: number;
}

interface Household {
  cohortWeek: string;
  /** 지금이 가입 주에서 몇 주 뒤인가. W_n은 currentOffset > n일 때 다 지났다. */
  currentOffset: number;
  patientWeeks: Set<number>;
  caregiverWeeks: Set<number>;
  sessionsByWeek: Map<number, number>;
}

/** 두 로컬 주 시작 사이 주 수. 둘 다 벽시계 0시라 서머타임에도 7일 배수다. */
const weekOffset = (bucket: string, cohort: string): string =>
  `round(extract(epoch from (${bucket} - ${cohort})) / 604800)::int`;

async function loadHouseholds(
  ds: DataSource,
  timezone: string,
  weekStart: number,
  opts: RetentionOptions,
): Promise<Map<string, Household>> {
  const wb = (col: string) => weekBucket(col, timezone, weekStart);
  const params = [
    timezone,
    weekStart,
    (opts.since ?? new Date(0)).toISOString(),
    opts.now.toISOString(),
  ];
  const patients = `
    SELECT u.id, ${wb('u.created_at')} AS cohort
    FROM users u
    WHERE u.role = 'patient' AND u.timezone = $1 AND u.week_start = $2
      AND u.created_at >= $3::timestamptz AND u.created_at < $4::timestamptz`;

  const rows: { id: string; cohort_week: string; current_offset: number }[] =
    await ds.query(
      `WITH p AS (${patients})
       SELECT p.id, to_char(p.cohort, 'YYYY-MM-DD') AS cohort_week,
              ${weekOffset(wb('$4::timestamptz'), 'p.cohort')} AS current_offset
       FROM p`,
      params,
    );

  const households = new Map<string, Household>();
  for (const r of rows) {
    households.set(r.id, {
      cohortWeek: r.cohort_week,
      currentOffset: r.current_offset,
      patientWeeks: new Set(),
      caregiverWeeks: new Set(),
      sessionsByWeek: new Map(),
    });
  }
  if (households.size === 0) return households;

  const activity: {
    kind: 'patient' | 'caregiver' | 'session';
    patient_id: string;
    week_offset: number;
    n: number;
  }[] = await ds.query(
    `WITH p AS (${patients}),
     act AS (
       SELECT 'patient' AS kind, r.patient_id, r.answered_at AS at
         FROM qab_results r JOIN p ON p.id = r.patient_id
       UNION ALL
       SELECT 'patient', c.patient_id, c.completed_at
         FROM qab_session_completions c JOIN p ON p.id = c.patient_id
       UNION ALL
       SELECT 'session', c.patient_id, c.completed_at
         FROM qab_session_completions c JOIN p ON p.id = c.patient_id
       UNION ALL
       SELECT 'caregiver', m.patient_id, m.created_at
         FROM memory_entries m JOIN p ON p.id = m.patient_id
       UNION ALL
       SELECT 'caregiver', m.patient_id, cr.created_at
         FROM caregiver_reflections cr
         JOIN memory_entries m ON m.id = cr.memory_entry_id
         JOIN p ON p.id = m.patient_id
       UNION ALL
       SELECT 'caregiver', m.patient_id, me.recorded_at
         FROM mood_entries me
         JOIN memory_entries m ON m.id = me.memory_entry_id
         JOIN p ON p.id = m.patient_id
     )
     SELECT a.kind, a.patient_id,
            ${weekOffset(wb('a.at'), 'p.cohort')} AS week_offset,
            count(*)::int AS n
     FROM act a JOIN p ON p.id = a.patient_id
     WHERE a.at < $4::timestamptz
     GROUP BY 1, 2, 3`,
    params,
  );

  for (const a of activity) {
    const h = households.get(a.patient_id);
    if (!h || a.week_offset < 0) continue;
    if (a.kind === 'patient') h.patientWeeks.add(a.week_offset);
    else if (a.kind === 'caregiver') h.caregiverWeeks.add(a.week_offset);
    else h.sessionsByWeek.set(a.week_offset, a.n);
  }
  return households;
}

function retention(
  households: Household[],
  week: number,
  isActive: (h: Household) => boolean,
): MetricValue {
  const eligible = households.filter((h) => h.currentOffset > week);
  const active = eligible.filter(isActive).length;
  return {
    value: eligible.length === 0 ? null : active / eligible.length,
    numerator: active,
    denominator: eligible.length,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function buildRetentionReport(
  ds: DataSource,
  opts: RetentionOptions,
): Promise<RetentionReport> {
  const combos: { timezone: string; week_start: number }[] = await ds.query(
    `SELECT DISTINCT timezone, week_start FROM users WHERE role = 'patient'
     ORDER BY 1, 2`,
  );

  const all: Household[] = [];
  for (const c of combos) {
    const loaded = await loadHouseholds(
      ds,
      assertTimezone(c.timezone),
      assertWeekStart(c.week_start),
      opts,
    );
    all.push(...loaded.values());
  }

  const byCohort = new Map<string, Household[]>();
  for (const h of all) {
    byCohort.set(h.cohortWeek, [...(byCohort.get(h.cohortWeek) ?? []), h]);
  }
  const cohorts: CohortRow[] = [...byCohort.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohortWeek, hs]) => {
      const col = (pick: (h: Household) => Set<number>) =>
        Array.from(
          { length: opts.weeks + 1 },
          (_, n) => retention(hs, n, (h) => pick(h).has(n)).value,
        );
      return {
        cohortWeek,
        households: hs.length,
        patient: col((h) => h.patientWeeks),
        caregiver: col((h) => h.caregiverWeeks),
      };
    });

  // 환자가 활동한 **다 지난** 주마다 완료 세션 수. 완료 없이 문항만 푼 주는 0으로 센다.
  const sessionCounts = all.flatMap((h) =>
    [...h.patientWeeks]
      .filter((w) => w < h.currentOffset)
      .map((w) => h.sessionsByWeek.get(w) ?? 0),
  );

  const metrics: Record<RetentionMetric, MetricValue> = {
    patient_w1_retention: retention(all, 1, (h) => h.patientWeeks.has(1)),
    patient_w4_retention: retention(all, 4, (h) => h.patientWeeks.has(4)),
    caregiver_w1_retention: retention(all, 1, (h) => h.caregiverWeeks.has(1)),
    caregiver_w4_retention: retention(all, 4, (h) => h.caregiverWeeks.has(4)),
    household_w4_retention: retention(
      all,
      4,
      (h) => h.patientWeeks.has(4) || h.caregiverWeeks.has(4),
    ),
    sessions_per_active_week_median: {
      value: median(sessionCounts),
      numerator: sessionCounts.reduce((a, b) => a + b, 0),
      denominator: sessionCounts.length,
    },
  };

  return {
    now: opts.now.toISOString(),
    since: opts.since ? opts.since.toISOString() : null,
    weeks: opts.weeks,
    households: all.length,
    cohorts,
    metrics,
  };
}

const pct = (v: number | null): string =>
  v === null ? '   —' : `${Math.round(v * 100)}%`.padStart(4);

export function formatRetentionReport(r: RetentionReport): string {
  const weeks = Array.from({ length: r.weeks + 1 }, (_, n) =>
    `W${n}`.padStart(4),
  ).join(' ');
  const lines = [
    `코호트 유지율 — 기준 ${r.now}, 가입 ${r.since ?? '(전체)'} 이후, 가구 ${r.households}`,
    '',
    `가입 주       가구 | 환자 ${weeks} | 보호자 ${weeks}`,
    ...r.cohorts.map(
      (c) =>
        `${c.cohortWeek}  ${String(c.households).padStart(4)} | ` +
        `     ${c.patient.map(pct).join(' ')} | ` +
        `       ${c.caregiver.map(pct).join(' ')}`,
    ),
    '',
    ...RETENTION_METRICS.map((name) => {
      const m = r.metrics[name];
      const v =
        m.value === null
          ? '—'
          : name.endsWith('_median')
            ? String(m.value)
            : m.value.toFixed(3);
      return `${name}=${v}  (${m.numerator}/${m.denominator})`;
    }),
  ];
  return lines.join('\n');
}

function parseArgs(argv: string[]): {
  since: Date | null;
  weeks: number;
  json: boolean;
} {
  const get = (key: string) =>
    argv.find((a) => a.startsWith(`--${key}=`))?.split('=')[1];
  const sinceArg = get('since');
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : null;
  if (since && Number.isNaN(since.getTime())) {
    throw new Error(`--since는 YYYY-MM-DD: ${sinceArg}`);
  }
  const weeks = Number(get('weeks') ?? 8);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new Error(`--weeks는 1~52 정수: ${get('weeks')}`);
  }
  return { since, weeks, json: argv.includes('--json') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // 스크립트로 실행될 때만 개발·운영 DB에 붙는다. 통합 테스트는 import만 한다.
  const { default: AppDataSource } =
    await import('../src/database/data-source');
  await AppDataSource.initialize();
  try {
    const report = await buildRetentionReport(AppDataSource, {
      now: new Date(),
      since: args.since,
      weeks: args.weeks,
    });
    console.log(
      args.json
        ? JSON.stringify(report, null, 2)
        : formatRetentionReport(report),
    );
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
