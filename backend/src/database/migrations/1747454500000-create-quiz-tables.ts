import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M3: Quiz 4개 테이블 신설
 *   1. quiz_sets         (FK → memory_entries, users)
 *   2. quiz_questions    (FK → quiz_sets, UNIQUE(quiz_set_id, order_index))
 *   3. quiz_attempts     (FK → quiz_sets, quiz_questions, users — UNIQUE 없음)
 *   4. quiz_best_scores  (FK → quiz_sets UNIQUE, users)
 */
export class CreateQuizTables1747454500000 implements MigrationInterface {
  name = 'CreateQuizTables1747454500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) quiz_sets
    await queryRunner.query(`
      CREATE TABLE "quiz_sets" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "memory_entry_id" UUID NOT NULL,
        "patient_id" UUID NOT NULL,
        "caregiver_id" UUID NOT NULL,
        "generation_status" VARCHAR(16) NOT NULL DEFAULT 'pending',
        "generation_error" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ready_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_quiz_sets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_quiz_sets_memory_entry"
          FOREIGN KEY ("memory_entry_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_quiz_sets_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_quiz_sets_caregiver"
          FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_quiz_sets_patient_status_created"
        ON "quiz_sets" ("patient_id", "generation_status", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_quiz_sets_memory_entry"
        ON "quiz_sets" ("memory_entry_id")
    `);

    // 2) quiz_questions
    await queryRunner.query(`
      CREATE TABLE "quiz_questions" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "quiz_set_id" UUID NOT NULL,
        "order_index" INT NOT NULL,
        "type" VARCHAR(16) NOT NULL,
        "prompt" TEXT NOT NULL,
        "choices" JSONB NULL,
        "correct_answer" TEXT NOT NULL,
        "hint_first_char" VARCHAR(8) NULL,
        "explanation" TEXT NULL,
        CONSTRAINT "PK_quiz_questions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_quiz_questions_set_order" UNIQUE ("quiz_set_id", "order_index"),
        CONSTRAINT "FK_quiz_questions_set"
          FOREIGN KEY ("quiz_set_id") REFERENCES "quiz_sets"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_quiz_questions_set" ON "quiz_questions" ("quiz_set_id")
    `);

    // 3) quiz_attempts (R5=(a) — UNIQUE 없음)
    await queryRunner.query(`
      CREATE TABLE "quiz_attempts" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "quiz_set_id" UUID NOT NULL,
        "question_id" UUID NOT NULL,
        "patient_id" UUID NOT NULL,
        "session_token" UUID NOT NULL,
        "user_answer" TEXT NOT NULL,
        "is_correct" BOOLEAN NOT NULL,
        "answered_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quiz_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_quiz_attempts_set"
          FOREIGN KEY ("quiz_set_id") REFERENCES "quiz_sets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_quiz_attempts_question"
          FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_quiz_attempts_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_quiz_attempts_set_session"
        ON "quiz_attempts" ("quiz_set_id", "session_token", "answered_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_quiz_attempts_patient_set"
        ON "quiz_attempts" ("patient_id", "quiz_set_id")
    `);

    // 4) quiz_best_scores (UNIQUE quiz_set_id)
    await queryRunner.query(`
      CREATE TABLE "quiz_best_scores" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "quiz_set_id" UUID NOT NULL,
        "patient_id" UUID NOT NULL,
        "best_score" INT NOT NULL,
        "best_session_token" UUID NOT NULL,
        "achieved_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quiz_best_scores" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_quiz_best_scores_set" UNIQUE ("quiz_set_id"),
        CONSTRAINT "FK_quiz_best_scores_set"
          FOREIGN KEY ("quiz_set_id") REFERENCES "quiz_sets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_quiz_best_scores_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_quiz_best_scores_patient"
        ON "quiz_best_scores" ("patient_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_best_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_attempts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_questions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_sets"`);
  }
}
