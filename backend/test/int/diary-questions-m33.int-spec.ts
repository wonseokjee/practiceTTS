import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { SeedMoreDiaryQuestions1786800000000 } from '../../src/database/migrations/1786800000000-seed-more-diary-questions';
import { openTestDataSource } from './test-database';

/**
 * M33 환자 일기 질문 추가 — 범주마다 7개, 멱등, 되돌리기가 답 달린 질문을 지키는지.
 *
 * down()은 mock으로 증명할 수 없다: patient_memory_notes.question_id가 RESTRICT FK라
 * 답이 달린 질문을 DELETE하면 실제 DB에서만 실패한다.
 */
describe('M33 환자 일기 질문 추가 (DB)', () => {
  let ds: DataSource;
  const migration = new SeedMoreDiaryQuestions1786800000000();

  const counts = async (): Promise<Record<string, number>> => {
    const rows = await ds.query<Array<{ category: string; n: number }>>(
      `SELECT category, count(*)::int AS n FROM diary_questions
        WHERE scope = 'patient' AND is_active GROUP BY category`,
    );
    return Object.fromEntries(rows.map((r) => [r.category, r.n]));
  };

  const run = async (dir: 'up' | 'down'): Promise<void> => {
    const qr = ds.createQueryRunner();
    try {
      await migration[dir](qr);
    } finally {
      await qr.release();
    }
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds.query('TRUNCATE users CASCADE');
    await ds.destroy();
  });

  it('globalSetup의 migration:run 뒤 범주마다 활성 질문이 7개다', async () => {
    expect(await counts()).toEqual({ activity: 7, moment: 7, context: 7 });
  });

  it('다시 돌려도 늘지 않는다(멱등)', async () => {
    await run('up');
    expect(await counts()).toEqual({ activity: 7, moment: 7, context: 7 });
  });

  it('되돌리면 답 없는 질문은 지우고, 답 달린 질문은 비활성화한다 — 다시 올리면 돌아온다', async () => {
    const [q] = await ds.query<Array<{ id: string }>>(
      `SELECT id FROM diary_questions WHERE text = '오늘 어제와 달랐던 점이 있다면 하나만 적어주세요.'`,
    );
    const caregiver = randomUUID();
    const patient = randomUUID();
    await ds.query(
      `INSERT INTO users (id, role, display_name) VALUES ($1, 'caregiver', 'c'), ($2, 'patient', 'p')`,
      [caregiver, patient],
    );
    const [entry] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO memory_entries (caregiver_id, patient_id) VALUES ($1, $2) RETURNING id`,
      [caregiver, patient],
    );
    await ds.query(
      `INSERT INTO patient_memory_notes (memory_entry_id, question_id, category, order_index, answer_text)
       VALUES ($1, $2, 'moment', 0, '오늘은 비가 왔어요')`,
      [entry.id, q.id],
    );

    await run('down');

    expect(await counts()).toEqual({ activity: 3, moment: 3, context: 3 });
    const kept = await ds.query<Array<{ is_active: boolean }>>(
      `SELECT is_active FROM diary_questions WHERE id = $1`,
      [q.id],
    );
    expect(kept).toEqual([{ is_active: false }]);

    await run('up');
    expect(await counts()).toEqual({ activity: 7, moment: 7, context: 7 });
  });
});
