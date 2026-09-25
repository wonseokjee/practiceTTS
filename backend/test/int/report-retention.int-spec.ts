import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  buildRetentionReport,
  formatRetentionReport,
  RETENTION_METRICS,
} from '../../scripts/report-retention';
import { openTestDataSource } from './test-database';

/**
 * `report:retention`을 빈 테스트 DB에 심은 두 가구로 1회 돌린다(계획 §13 8-2).
 *
 * 기준 시각은 2026-10-28T03:00Z로 고정한다 — 서울은 수요일 정오(주 = 10-26 월),
 * LA는 화요일 저녁 20시 PDT(주 = 10-25 일).
 *
 *   A 서울·월요일 시작  가입 09-21 월 10:00 KST → 코호트 2026-09-21, 지금 W5
 *     문항  09-28 월 00:30 KST (= 09-27 15:30Z, UTC로는 일요일) → W1
 *           받은 시각(created_at)은 10-20 → 받은 시각으로 세면 W4가 된다
 *     완료  09-28 11:00 KST → W1, 세션 1
 *     기억  10-19 월 09:00 KST → 보호자 W4
 *
 *   B LA·일요일 시작    가입 09-20 일 12:00 PDT → 코호트 2026-09-20, 지금 W5
 *     문항  09-27 일 00:30 PDT (= 07:30Z, 서울 기준으론 전 주) → W1
 *     기억  09-20 일 17:00 PDT → 보호자 W0
 *     회고  10-18 일 01:00 PDT → 보호자 W4   (보호자 users.patient_id는 NULL —
 *     기분  10-17 토 23:00 PDT → 보호자 W3    기억 기록으로 이어야 잡힌다)
 *
 *   C 서울  가입 10-20 → 코호트 2026-10-19, 지금 W1 — W1 분모에 안 들어간다
 *   D 서울  가입 10-29 (기준 시각 뒤) → 제외
 */
const NOW = new Date('2026-10-28T03:00:00Z');

describe('report:retention', () => {
  let ds: DataSource;

  const user = async (
    role: string,
    createdAt: string,
    timezone = 'Asia/Seoul',
    weekStart = 1,
  ): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name, created_at, timezone, week_start)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, role, `${role}-${id.slice(0, 4)}`, createdAt, timezone, weekStart],
    );
    return id;
  };

  const memory = async (
    caregiverId: string,
    patientId: string,
    createdAt: string,
  ): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO memory_entries (id, caregiver_id, patient_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [id, caregiverId, patientId, createdAt],
    );
    return id;
  };

  beforeAll(async () => {
    ds = await openTestDataSource();

    // A — 서울, 월요일 시작
    const a = await user('patient', '2026-09-21T01:00:00Z');
    const ga = await user('caregiver', '2026-09-21T01:00:00Z');
    await ds.query(
      `INSERT INTO qab_results
         (patient_id, session_token, subtest, item_ref, is_correct, answered_at, created_at)
       VALUES ($1, $2, 'word', 'w1', true, '2026-09-27T15:30:00Z', '2026-10-20T01:00:00Z')`,
      [a, randomUUID()],
    );
    await ds.query(
      `INSERT INTO qab_session_completions (session_token, patient_id, completed_at)
       VALUES ($1, $2, '2026-09-28T02:00:00Z')`,
      [randomUUID(), a],
    );
    await memory(ga, a, '2026-10-19T00:00:00Z');

    // B — LA, 일요일 시작
    const b = await user(
      'patient',
      '2026-09-20T19:00:00Z',
      'America/Los_Angeles',
      0,
    );
    const gb = await user(
      'caregiver',
      '2026-09-20T19:00:00Z',
      'America/Los_Angeles',
      0,
    );
    await ds.query(
      `INSERT INTO qab_results
         (patient_id, session_token, subtest, item_ref, is_correct, answered_at, created_at)
       VALUES ($1, $2, 'word', 'w1', false, '2026-09-27T07:30:00Z', '2026-09-27T07:30:00Z')`,
      [b, randomUUID()],
    );
    const mb = await memory(gb, b, '2026-09-21T00:00:00Z');
    const [{ id: q }]: { id: string }[] = await ds.query(
      `INSERT INTO diary_questions (scope, text) VALUES ('test', '테스트 질문') RETURNING id`,
    );
    await ds.query(
      `INSERT INTO caregiver_reflections
         (memory_entry_id, caregiver_id, question_id, answer_text, created_at)
       VALUES ($1, $2, $3, '회고', '2026-10-18T08:00:00Z')`,
      [mb, gb, q],
    );
    await ds.query(
      `INSERT INTO mood_entries (memory_entry_id, caregiver_id, mood_level, recorded_at)
       VALUES ($1, $2, 3, '2026-10-18T06:00:00Z')`,
      [mb, gb],
    );

    // C — 가입 주가 막 지남, D — 기준 시각 뒤 가입, 치료사 — 세지 않음
    await user('patient', '2026-10-20T01:00:00Z');
    await user('patient', '2026-10-29T01:00:00Z');
    await user('therapist', '2026-09-01T00:00:00Z');
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users, diary_questions CASCADE');
    await ds.destroy();
  });

  it('코호트 표 — 주는 환자 타임존·주 시작으로, 활동은 푼 시각으로 자른다', async () => {
    const r = await buildRetentionReport(ds, { now: NOW, weeks: 5 });

    expect(r.households).toBe(3);
    expect(r.cohorts).toEqual([
      {
        cohortWeek: '2026-09-20', // B — LA 일요일
        households: 1,
        patient: [0, 1, 0, 0, 0, null],
        caregiver: [1, 0, 0, 1, 1, null],
      },
      {
        cohortWeek: '2026-09-21', // A — 서울 월요일
        households: 1,
        patient: [0, 1, 0, 0, 0, null],
        caregiver: [0, 0, 0, 0, 1, null],
      },
      {
        cohortWeek: '2026-10-19', // C — W0만 다 지났다
        households: 1,
        patient: [0, null, null, null, null, null],
        caregiver: [0, null, null, null, null, null],
      },
    ]);
  });

  it('요약 지표 — ③절이 인용하는 이름과 값', async () => {
    const r = await buildRetentionReport(ds, { now: NOW, weeks: 5 });

    expect(Object.keys(r.metrics)).toEqual([...RETENTION_METRICS]);
    expect(r.metrics).toEqual({
      // C는 W1이 아직 안 지나 분모에서 빠진다
      patient_w1_retention: { value: 1, numerator: 2, denominator: 2 },
      patient_w4_retention: { value: 0, numerator: 0, denominator: 2 },
      caregiver_w1_retention: { value: 0, numerator: 0, denominator: 2 },
      caregiver_w4_retention: { value: 1, numerator: 2, denominator: 2 },
      household_w4_retention: { value: 1, numerator: 2, denominator: 2 },
      // A의 W1 = 완료 1, B의 W1 = 문항만 풀고 완료 0 → 중앙값 0.5
      sessions_per_active_week_median: {
        value: 0.5,
        numerator: 1,
        denominator: 2,
      },
    });
  });

  it('--since 이전 가입 가구는 뺀다', async () => {
    const r = await buildRetentionReport(ds, {
      now: NOW,
      weeks: 5,
      since: new Date('2026-09-21T00:00:00Z'), // B(09-20 19:00Z) 제외
    });

    expect(r.households).toBe(2);
    expect(r.cohorts.map((c) => c.cohortWeek)).toEqual([
      '2026-09-21',
      '2026-10-19',
    ]);
  });

  it('출력 — 지표마다 name=value (분자/분모) 한 줄', async () => {
    const text = formatRetentionReport(
      await buildRetentionReport(ds, { now: NOW, weeks: 5 }),
    );

    expect(text).toContain('patient_w1_retention=1.000  (2/2)');
    expect(text).toContain('sessions_per_active_week_median=0.5  (1/2)');
    expect(text).toContain('2026-09-20');
  });

  it('로케일 축 — 기본은 ko-KR만 세고, 미국 가구는 섞이지 않는다', async () => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name, created_at, timezone, week_start, locale)
       VALUES ($1, 'patient', 'us-patient', '2026-09-21T01:00:00Z', 'Asia/Seoul', 1, 'en-US')`,
      [id],
    );
    try {
      const ko = await buildRetentionReport(ds, { now: NOW, weeks: 5 });
      const en = await buildRetentionReport(ds, {
        now: NOW,
        weeks: 5,
        locale: 'en-US',
      });
      const all = await buildRetentionReport(ds, {
        now: NOW,
        weeks: 5,
        locale: null,
      });

      expect(ko.households).toBe(3);
      expect(ko.locale).toBe('ko-KR');
      expect(en.households).toBe(1);
      expect(all.households).toBe(4);
      // 미국 가구는 활동이 없어 W1 분모에는 들어가지만 분자에는 없다 — 섞이면 ko 수치가 떨어진다
      expect(ko.metrics.patient_w1_retention).toMatchObject({
        numerator: 2,
        denominator: 2,
      });
    } finally {
      await ds.query('DELETE FROM users WHERE id = $1', [id]);
    }
  });
});
