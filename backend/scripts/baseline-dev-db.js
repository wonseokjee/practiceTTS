/**
 * 개발 DB 베이스라인 — synchronize로 만들어진 스키마를 마이그레이션 기준으로 맞춘다.
 *
 * 배경
 * ----
 * 개발 DB는 `synchronize: true` 시절에 엔티티로부터 생성돼 `migrations` 테이블이
 * 비어 있다. 그래서 `migration:run`을 돌리면 M0(CreateInitialSchema)부터 실행하려다
 * 42P07(테이블 중복)로 실패한다. 동시에 스키마 자체도 마이그레이션 결과와 다르다:
 *
 *   - 타임스탬프 17개가 TIMESTAMP (마이그레이션은 TIMESTAMPTZ)
 *   - FK 이름이 TypeORM 해시 (마이그레이션은 FK_users_patient 같은 읽는 이름)
 *
 * `schema:sync`를 쓰면 타임스탬프 컬럼을 DROP 후 재생성해 **생성일자가 전부
 * 날아간다**. 그래서 값을 보존하는 ALTER와 제약 RENAME으로 제자리에서 맞추고,
 * 마지막에 마이그레이션 12건을 "적용됨"으로 기록한다.
 *
 * 여러 번 돌려도 안전하다(이미 맞춰진 항목은 건너뛴다).
 *
 * 사용:  cd backend && node scripts/baseline-dev-db.js
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

/** 마이그레이션이 쓰는 FK 이름 (테이블, 컬럼) → 제약 이름 */
const FK_NAMES = [
  ['users', 'patient_id', 'FK_users_patient'],
  ['memory_entries', 'caregiver_id', 'FK_memory_entries_caregiver'],
  ['memory_entries', 'patient_id', 'FK_memory_entries_patient'],
  ['conversation_logs', 'session_id', 'FK_conversation_logs_session'],
  ['training_sessions', 'patient_id', 'FK_training_sessions_patient'],
  ['training_sessions', 'memory_entry_id', 'FK_training_sessions_memory_entry'],
  ['quiz_sets', 'memory_entry_id', 'FK_quiz_sets_memory_entry'],
  ['quiz_sets', 'patient_id', 'FK_quiz_sets_patient'],
  ['quiz_sets', 'caregiver_id', 'FK_quiz_sets_caregiver'],
  ['quiz_questions', 'quiz_set_id', 'FK_quiz_questions_set'],
  ['quiz_attempts', 'quiz_set_id', 'FK_quiz_attempts_set'],
  ['quiz_attempts', 'question_id', 'FK_quiz_attempts_question'],
  ['quiz_attempts', 'patient_id', 'FK_quiz_attempts_patient'],
  ['quiz_best_scores', 'quiz_set_id', 'FK_quiz_best_scores_set'],
  ['quiz_best_scores', 'patient_id', 'FK_quiz_best_scores_patient'],
  ['qab_results', 'patient_id', 'FK_qab_results_patient'],
  ['mood_entries', 'memory_entry_id', 'FK_mood_entries_memory_entry'],
  ['mood_entries', 'caregiver_id', 'FK_mood_entries_caregiver'],
  ['caregiver_reflections', 'memory_entry_id', 'FK_caregiver_reflections_memory_entry'],
  ['caregiver_reflections', 'caregiver_id', 'FK_caregiver_reflections_caregiver'],
  ['caregiver_reflections', 'question_id', 'FK_caregiver_reflections_question'],
  ['patient_memory_notes', 'memory_entry_id', 'FK_patient_memory_notes_memory_entry'],
  ['patient_memory_notes', 'question_id', 'FK_patient_memory_notes_question'],
  ['family_members', 'profile_id', 'FK_family_members_profile'],
];

async function main() {
  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_DATABASE ?? 'memorylink',
  });
  await client.connect();
  console.log(`대상 DB: ${client.database}`);

  // 운영 DB에서 돌면 되돌리기 어렵다. 마이그레이션 12건을 "적용됨"으로 거짓
  // 기록하므로, 이후 migration:run이 실제로 필요한 마이그레이션을 건너뛴다.
  // 개발 DB 베이스라인 전용이라는 걸 코드로 못박는다.
  const looksProduction =
    process.env.NODE_ENV === 'production' ||
    /prod/i.test(client.database ?? '');
  const confirmed = process.argv.includes('--i-know-this-is-not-production');
  if (looksProduction && !confirmed) {
    console.error(
      `거부: 운영으로 보이는 대상이다 (NODE_ENV=${process.env.NODE_ENV ?? '미설정'}, DB=${client.database}).\n` +
        '이 스크립트는 synchronize로 만들어진 개발 DB를 베이스라인하는 용도다.\n' +
        '정말 의도한 것이라면 --i-know-this-is-not-production 플래그를 붙여라.',
    );
    await client.end();
    process.exitCode = 1;
    return;
  }

  await client.query('BEGIN');
  try {
    // 1) 타임스탬프 → TIMESTAMPTZ (값 보존)
    const tsCols = await client.query(`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'timestamp without time zone'
    `);
    // 저장된 naive 값은 `now()`가 **세션 타임존의 벽시계**로 기록한 것이다.
    // 이를 'UTC'로 해석하면 서버 오프셋만큼(KST면 9시간) 통째로 밀린다.
    // 반드시 세션 타임존으로 해석해야 원래 순간이 보존된다.
    for (const { table_name, column_name } of tsCols.rows) {
      await client.query(
        `ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE TIMESTAMPTZ USING "${column_name}" AT TIME ZONE current_setting('TimeZone')`,
      );
    }
    console.log(`타임스탬프 → TIMESTAMPTZ: ${tsCols.rowCount}개`);

    // 2) FK 이름을 마이그레이션 기준으로 RENAME
    let renamed = 0;
    for (const [table, column, wanted] of FK_NAMES) {
      const found = await client.query(
        `SELECT con.conname
           FROM pg_constraint con
           JOIN pg_class rel ON rel.oid = con.conrelid
           JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = con.conkey[1]
          WHERE con.contype = 'f' AND rel.relname = $1 AND att.attname = $2`,
        [table, column],
      );
      const current = found.rows[0]?.conname;
      if (!current || current === wanted) continue;
      await client.query(
        `ALTER TABLE "${table}" RENAME CONSTRAINT "${current}" TO "${wanted}"`,
      );
      renamed += 1;
    }
    console.log(`FK 이름 정정: ${renamed}개`);

    // 3) 마이그레이션 12건을 "적용됨"으로 기록 (스키마는 이미 그 상태다)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "migrations" (
        "id" SERIAL PRIMARY KEY,
        "timestamp" BIGINT NOT NULL,
        "name" VARCHAR NOT NULL
      )
    `);
    const dir = path.join(__dirname, '..', 'src', 'database', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
    let inserted = 0;
    for (const file of files) {
      const ts = file.split('-')[0];
      const src = fs.readFileSync(path.join(dir, file), 'utf-8');
      const cls = src.match(/export class (\w+)/)?.[1];
      if (!cls) continue;
      const exists = await client.query('SELECT 1 FROM migrations WHERE name = $1', [cls]);
      if (exists.rowCount > 0) continue;
      await client.query('INSERT INTO migrations("timestamp", name) VALUES ($1, $2)', [ts, cls]);
      inserted += 1;
    }
    console.log(`마이그레이션 이력 기록: ${inserted}건 (전체 ${files.length}건)`);

    await client.query('COMMIT');
    console.log('베이스라인 완료 — 이제 migration:run 이 정상 동작한다.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('실패, 롤백함:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
