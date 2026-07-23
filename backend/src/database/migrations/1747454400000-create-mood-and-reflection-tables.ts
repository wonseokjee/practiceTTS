import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M2: Memory 4개 테이블 신설
 *   1. diary_questions      (다른 3개의 FK 참조 대상이므로 먼저 생성)
 *   2. patient_memory_notes (FK → memory_entries, diary_questions)
 *   3. caregiver_reflections(FK → memory_entries, users, diary_questions)
 *   4. mood_entries         (FK → memory_entries UNIQUE, users + CHECK 1..5)
 *
 * 모든 테이블은 동일 트랜잭션 내 생성된다 (TypeORM의 기본 마이그레이션 트랜잭션).
 * Down 시에는 FK 의존 역순으로 DROP.
 */
export class CreateMoodAndReflectionTables1747454400000 implements MigrationInterface {
  name = 'CreateMoodAndReflectionTables1747454400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) diary_questions (정적 질문 풀)
    await queryRunner.query(`
      CREATE TABLE "diary_questions" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "scope" VARCHAR(16) NOT NULL,
        "category" VARCHAR(16) NULL,
        "text" VARCHAR(200) NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "order_hint" SMALLINT NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_diary_questions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_diary_questions_scope_cat_active"
        ON "diary_questions" ("scope", "category", "is_active")
    `);

    // 2) patient_memory_notes
    await queryRunner.query(`
      CREATE TABLE "patient_memory_notes" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "memory_entry_id" UUID NOT NULL,
        "question_id" UUID NOT NULL,
        "category" VARCHAR(16) NOT NULL,
        "order_index" SMALLINT NOT NULL,
        "answer_text" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient_memory_notes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_patient_memory_notes_entry_order"
          UNIQUE ("memory_entry_id", "order_index"),
        CONSTRAINT "FK_patient_memory_notes_memory_entry"
          FOREIGN KEY ("memory_entry_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_patient_memory_notes_question"
          FOREIGN KEY ("question_id") REFERENCES "diary_questions"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_patient_memory_notes_entry_cat"
        ON "patient_memory_notes" ("memory_entry_id", "category")
    `);

    // 3) caregiver_reflections (사적 답변)
    await queryRunner.query(`
      CREATE TABLE "caregiver_reflections" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "memory_entry_id" UUID NOT NULL,
        "caregiver_id" UUID NOT NULL,
        "question_id" UUID NOT NULL,
        "answer_text" TEXT NOT NULL,
        "is_private" BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_caregiver_reflections" PRIMARY KEY ("id"),
        CONSTRAINT "FK_caregiver_reflections_memory_entry"
          FOREIGN KEY ("memory_entry_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_caregiver_reflections_caregiver"
          FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_caregiver_reflections_question"
          FOREIGN KEY ("question_id") REFERENCES "diary_questions"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_caregiver_reflections_caregiver_created"
        ON "caregiver_reflections" ("caregiver_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_caregiver_reflections_memory_entry"
        ON "caregiver_reflections" ("memory_entry_id")
    `);

    // 4) mood_entries (1:1 with memory_entries, CHECK 1..5)
    await queryRunner.query(`
      CREATE TABLE "mood_entries" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "memory_entry_id" UUID NOT NULL,
        "caregiver_id" UUID NOT NULL,
        "mood_level" SMALLINT NOT NULL,
        "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mood_entries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_mood_entries_memory_entry" UNIQUE ("memory_entry_id"),
        CONSTRAINT "CHK_mood_entries_level_range" CHECK ("mood_level" BETWEEN 1 AND 5),
        CONSTRAINT "FK_mood_entries_memory_entry"
          FOREIGN KEY ("memory_entry_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_mood_entries_caregiver"
          FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_mood_entries_caregiver_recorded"
        ON "mood_entries" ("caregiver_id", "recorded_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // FK 의존 역순으로 명시적 DROP (CASCADE 사용 금지)
    await queryRunner.query(`DROP TABLE IF EXISTS "mood_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "caregiver_reflections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "patient_memory_notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "diary_questions"`);
  }
}
