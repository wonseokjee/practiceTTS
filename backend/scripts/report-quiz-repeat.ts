/**
 * 기억 퀴즈 반복률 리포트 — 같은 환자에게 최근에 낸 정답을 또 내는가.
 *
 * 환자의 하루가 단조로우면 보호자 메모가 비슷하고, 같은 정답이 되풀이되면 말 꺼내기
 * 연습이 아니라 답 외우기가 된다. #297(최근 3일 정답 회피 + 출제 축 회전)·#300
 * (질문 풀 확대)이 충분한지, 창 3일이 맞는지를 이 숫자로 판단한다
 * (TODOS `quiz-repeat-measure`).
 *
 * ## 무엇을 세나
 *
 * 문항 하나(ready 세트의 quiz_questions 행)가 단위다. 같은 환자의 **이전** ready
 * 세트 중 창(N일) 안에 만들어진 것에 **같은 유형·같은 정답**이 있으면 반복이다.
 * 객관식과 따라 말하기를 따로 센다 — 생성기의 반복 필터도 둘을 따로 본다.
 *
 *   반복률       = 반복 문항 / 대상 문항
 *   대상 문항    = 창 안에 이전 세트가 하나라도 있는 문항. 환자의 첫 세트나 오래
 *                  쉬다 만든 세트는 반복될 수가 없으니 분모에서 뺀다(넣으면 희석된다).
 *   문장까지 같음 = 정답에 더해 문장도 같은 객관식(말만 바꾼 반복과 구분).
 *
 * 비교는 대소문자·공백·문장부호를 무시한다(생성기 `_normalize`와 같은 취지).
 * 창은 1·3·7일. 생성기가 막는 창은 3일이라 3일 반복률은 0에 가까워야 하고,
 * 7일은 "며칠 뒤 다시 묻기"가 얼마나 일어나는지를 보여준다.
 *
 * 실행:
 *   cd backend && npm run report:quiz-repeat -- [--since=2026-10-11] [--json] [--locale=all]
 *   --since : 이 날짜(UTC 0시) 이후 만든 세트의 문항만 센다(이전 세트는 비교 대상으로는 본다).
 *             #297 배포 전후를 가를 때 쓴다.
 *   --locale: 환자 로케일(기본 ko-KR). `all`이면 전부.
 */
import { DataSource } from 'typeorm';
import { DEFAULT_LOCALE } from '../src/common/locale';

export const REPEAT_WINDOWS_DAYS = [1, 3, 7] as const;

/** 반복 비교에 쓰는 유형. 옛 세트의 fill_blank·tile_arrange는 세지 않는다. */
export const REPEAT_TYPES = ['multiple_choice', 'speech'] as const;
export type RepeatType = (typeof REPEAT_TYPES)[number];

export interface RepeatCell {
  /** 기간 안 문항 전체 */
  questions: number;
  /** 창 안에 이전 세트가 있는 문항 = 분모 */
  eligible: number;
  /** 같은 유형·같은 정답이 창 안에 있었던 문항 */
  repeated: number;
  /** 객관식만: 문장까지 같았던 문항 (speech는 고정 안내라 0) */
  exactRepeated: number;
  /** repeated / eligible. 분모가 0이면 null — 0%와 "아직 모름"은 다르다. */
  rate: number | null;
}

export interface QuizRepeatReport {
  now: string;
  since: string | null;
  locale: string | null;
  patients: number;
  sets: number;
  /** windows[창일수][유형] */
  windows: Record<number, Record<RepeatType, RepeatCell>>;
}

export interface QuizRepeatOptions {
  /** 기준 시각. 테스트가 고정할 수 있게 인자로 받는다. */
  now: Date;
  since?: Date | null;
  /** 생략하면 ko-KR, null이면 로케일 구분 없이 전부. */
  locale?: string | null;
}

const NORMALIZE = (col: string) =>
  `lower(regexp_replace(${col}, '[[:space:][:punct:]]', '', 'g'))`;

export async function buildQuizRepeatReport(
  ds: DataSource,
  opts: QuizRepeatOptions,
): Promise<QuizRepeatReport> {
  const locale = opts.locale === undefined ? DEFAULT_LOCALE : opts.locale;
  const params = [
    opts.now.toISOString(),
    (opts.since ?? new Date(0)).toISOString(),
    locale,
  ];
  // 비교 대상(prev)은 since 이전 세트도 포함한다 — since 직후 첫 세트가 그 전날
  // 문제를 반복했는지도 세야 하므로.
  const base = `
    SELECT s.patient_id, s.id AS set_id, s.created_at, qq.type,
           ${NORMALIZE('qq.correct_answer')} AS ans,
           ${NORMALIZE('qq.prompt')} AS pr
      FROM quiz_questions qq
      JOIN quiz_sets s ON s.id = qq.quiz_set_id
      JOIN users u ON u.id = s.patient_id
     WHERE s.generation_status = 'ready'
       AND s.created_at < $1::timestamptz
       AND ($3::text IS NULL OR u.locale = $3)
       AND qq.type IN ('multiple_choice', 'speech')`;

  const [{ patients, sets }] = await ds.query<
    Array<{ patients: number; sets: number }>
  >(
    `WITH q AS (${base})
     SELECT count(DISTINCT patient_id)::int AS patients,
            count(DISTINCT set_id)::int AS sets
       FROM q WHERE created_at >= $2::timestamptz`,
    params,
  );

  const windows = {} as QuizRepeatReport['windows'];
  for (const days of REPEAT_WINDOWS_DAYS) {
    const rows = await ds.query<
      Array<{
        type: RepeatType;
        questions: number;
        eligible: number;
        repeated: number;
        exact_repeated: number;
      }>
    >(
      `WITH q AS (${base}),
       cur AS (
         SELECT c.*,
                EXISTS (
                  SELECT 1 FROM q p
                   WHERE p.patient_id = c.patient_id AND p.set_id <> c.set_id
                     AND p.created_at < c.created_at
                     AND p.created_at >= c.created_at - $4::int * interval '1 day'
                ) AS eligible,
                EXISTS (
                  SELECT 1 FROM q p
                   WHERE p.patient_id = c.patient_id AND p.set_id <> c.set_id
                     AND p.created_at < c.created_at
                     AND p.created_at >= c.created_at - $4::int * interval '1 day'
                     AND p.type = c.type AND p.ans = c.ans
                ) AS repeated,
                c.type = 'multiple_choice' AND EXISTS (
                  SELECT 1 FROM q p
                   WHERE p.patient_id = c.patient_id AND p.set_id <> c.set_id
                     AND p.created_at < c.created_at
                     AND p.created_at >= c.created_at - $4::int * interval '1 day'
                     AND p.type = c.type AND p.ans = c.ans AND p.pr = c.pr
                ) AS exact_repeated
           FROM q c
          WHERE c.created_at >= $2::timestamptz
       )
       SELECT type,
              count(*)::int AS questions,
              count(*) FILTER (WHERE eligible)::int AS eligible,
              count(*) FILTER (WHERE repeated)::int AS repeated,
              count(*) FILTER (WHERE exact_repeated)::int AS exact_repeated
         FROM cur GROUP BY type`,
      [...params, days],
    );
    const byType = Object.fromEntries(
      REPEAT_TYPES.map((type) => {
        const r = rows.find((row) => row.type === type);
        const cell: RepeatCell = {
          questions: r?.questions ?? 0,
          eligible: r?.eligible ?? 0,
          repeated: r?.repeated ?? 0,
          exactRepeated: r?.exact_repeated ?? 0,
          rate: r && r.eligible > 0 ? r.repeated / r.eligible : null,
        };
        return [type, cell];
      }),
    ) as Record<RepeatType, RepeatCell>;
    windows[days] = byType;
  }

  return {
    now: opts.now.toISOString(),
    since: opts.since ? opts.since.toISOString() : null,
    locale,
    patients,
    sets,
    windows,
  };
}

const TYPE_LABEL: Record<RepeatType, string> = {
  multiple_choice: '객관식',
  speech: '따라 말하기',
};

const pct = (v: number | null): string =>
  v === null ? '—' : `${(v * 100).toFixed(1)}%`;

export function formatQuizRepeatReport(r: QuizRepeatReport): string {
  const lines = [
    `기억 퀴즈 반복률 (기준 ${r.now}${r.since ? `, ${r.since} 이후 세트` : ''}, 로케일 ${r.locale ?? '전부'})`,
    `환자 ${r.patients}명 · 세트 ${r.sets}개`,
    '',
    '창   유형         반복률   반복/대상   (문장까지 같음)  전체 문항',
  ];
  for (const days of REPEAT_WINDOWS_DAYS) {
    for (const type of REPEAT_TYPES) {
      const c = r.windows[days][type];
      lines.push(
        [
          `${days}일`.padEnd(4),
          TYPE_LABEL[type].padEnd(10),
          pct(c.rate).padStart(7),
          `${c.repeated}/${c.eligible}`.padStart(10),
          (type === 'multiple_choice' ? String(c.exactRepeated) : '—').padStart(
            14,
          ),
          String(c.questions).padStart(10),
        ].join('  '),
      );
    }
  }
  lines.push(
    '',
    '대상 = 창 안에 이전 세트가 있는 문항. 생성기가 막는 창은 3일이라 3일 반복률은 0에 가까워야 한다.',
  );
  return lines.join('\n');
}

function parseArgs(argv: string[]): {
  since: Date | null;
  json: boolean;
  locale: string | null;
} {
  const get = (key: string) =>
    argv.find((a) => a.startsWith(`--${key}=`))?.split('=')[1];
  const sinceArg = get('since');
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : null;
  if (since && Number.isNaN(since.getTime())) {
    throw new Error(`--since는 YYYY-MM-DD: ${sinceArg}`);
  }
  const localeArg = get('locale') ?? DEFAULT_LOCALE;
  return {
    since,
    json: argv.includes('--json'),
    locale: localeArg === 'all' ? null : localeArg,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // 스크립트로 실행될 때만 개발·운영 DB에 붙는다. 통합 테스트는 import만 한다.
  const { default: AppDataSource } =
    await import('../src/database/data-source');
  await AppDataSource.initialize();
  try {
    const report = await buildQuizRepeatReport(AppDataSource, {
      now: new Date(),
      since: args.since,
      locale: args.locale,
    });
    console.log(
      args.json
        ? JSON.stringify(report, null, 2)
        : formatQuizRepeatReport(report),
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
