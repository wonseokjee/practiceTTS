import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M0: 초기 스키마 (베이스라인)
 *
 * 배경: 이 프로젝트는 dev에서 synchronize:true로 스키마를 자동 생성해왔고,
 * users/memory_entries/training_sessions/conversation_logs/qab_results는
 * 어떤 마이그레이션도 생성한 적이 없다. 그 결과 기존 마이그레이션 체인은
 * 빈 DB에서 첫 마이그레이션(ALTER "memory_entries")부터 실패했다.
 * 본 베이스라인이 그 공백을 메워 빈 DB → 최신 스키마 재현을 가능하게 한다.
 *
 * 주의: 뒤따르는 ALTER 마이그레이션이 추가하는 컬럼은 여기서 만들지 않는다.
 *   - memory_entries.caregiver_wish_message → M1(1747454300000)
 *   - users.patient_mode_pin_hash           → M5(1748600000000)
 * (두 ALTER 모두 ADD COLUMN IF NOT EXISTS라 순서만 지키면 안전하다.)
 *
 * IF NOT EXISTS를 쓰는 이유: 이 베이스라인은 기존 마이그레이션들보다 앞선
 * 타임스탬프를 갖는다(공백을 메우려면 그래야 한다). 그래서 synchronize:true로
 * 이미 스키마가 만들어진 DB에 체인을 처음 돌리면 여기서 "already exists"로
 * 터진다. IF NOT EXISTS면 그런 DB에서도 no-op으로 지나가 뒤 마이그레이션이
 * 이어진다. 빈 DB에서는 평소대로 전부 생성한다.
 *
 * 생성 순서는 FK 의존을 따른다:
 *   users → memory_entries → training_sessions → conversation_logs, qab_results
 */
export class CreateInitialSchema1747454200000 implements MigrationInterface {
  name = 'CreateInitialSchema1747454200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) users (patient_id 자기참조 FK — 보호자가 담당 환자를 가리킨다)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "email" VARCHAR NOT NULL,
        "password_hash" VARCHAR NOT NULL,
        "role" VARCHAR(20) NOT NULL,
        "display_name" VARCHAR NOT NULL,
        "patient_id" UUID NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "FK_users_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // 2) memory_entries (보호자·환자 FK)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "memory_entries" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "caregiver_id" UUID NOT NULL,
        "patient_id" UUID NOT NULL,
        "photo_url" VARCHAR NULL,
        "location_tag" VARCHAR NULL,
        "object_tags" JSONB NULL,
        "emotion_tag" VARCHAR NULL,
        "target_words" TEXT NULL,
        "masked_context" TEXT NULL,
        "scenario_cache" TEXT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_memory_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_memory_entries_caregiver"
          FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_memory_entries_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // 3) training_sessions (환자·메모리엔트리 FK)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "training_sessions" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" UUID NOT NULL,
        "memory_entry_id" UUID NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'active',
        "hint_level" INT NOT NULL DEFAULT 0,
        "target_word_used" VARCHAR NULL,
        "success" BOOLEAN NULL,
        "duration_ms" INT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_training_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_training_sessions_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_training_sessions_memory_entry"
          FOREIGN KEY ("memory_entry_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE
      )
    `);

    // 4) conversation_logs (세션 FK, content는 AES 암호문)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation_logs" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "session_id" UUID NOT NULL,
        "role" VARCHAR(10) NOT NULL,
        "content" TEXT NOT NULL,
        "hint_triggered" BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_conversation_logs_session"
          FOREIGN KEY ("session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE
      )
    `);

    // 5) qab_results (환자 FK + 멱등 dedup 인덱스)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "qab_results" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" UUID NOT NULL,
        "session_token" UUID NOT NULL,
        "subtest" VARCHAR(16) NOT NULL,
        "item_ref" VARCHAR(100) NOT NULL,
        "is_correct" BOOLEAN NOT NULL,
        "assisted" BOOLEAN NOT NULL DEFAULT FALSE,
        "metric" INT NULL,
        "score" INT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_qab_results" PRIMARY KEY ("id"),
        CONSTRAINT "FK_qab_results_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_qab_results_patient_subtest"
        ON "qab_results" ("patient_id", "subtest")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_qab_results_session" ON "qab_results" ("session_token")
    `);
    // 멱등성: 같은 세션의 같은 문항 결과는 1행만 (재시도 중복 집계 방지)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_qab_results_dedup"
        ON "qab_results" ("patient_id", "session_token", "subtest", "item_ref")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // FK 의존 역순으로 DROP
    await queryRunner.query(`DROP TABLE IF EXISTS "qab_results"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "training_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "memory_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
