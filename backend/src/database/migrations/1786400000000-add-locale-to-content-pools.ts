import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M32: `healing_messages`·`diary_questions`에 `locale`.
 *
 * 두 풀 모두 로케일 컬럼이 없어서, 영어 문항을 넣는 순간 한국어 사용자에게도
 * 그대로 나갔다(영어판 실행 계획 §17, M1 Exit ⑨a). 기존 행은 전부 한국어라
 * DEFAULT 'ko-KR'로 채운다. 조회는 요청 사용자의 `users.locale`로 거른다 —
 * 그 로케일의 풀이 비어 있으면 404(HEALING_POOL_EMPTY / QUESTION_POOL_EMPTY)라
 * 다른 언어 문구로 대체되지 않는다(fail-closed).
 *
 * 컬럼 추가 + DEFAULT는 메타데이터 변경이라 잠금이 짧다(PG 11+).
 */
export class AddLocaleToContentPools1786400000000 implements MigrationInterface {
  name = 'AddLocaleToContentPools1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "healing_messages" ADD COLUMN IF NOT EXISTS "locale" character varying(8) NOT NULL DEFAULT 'ko-KR'`,
    );
    await queryRunner.query(
      `ALTER TABLE "diary_questions" ADD COLUMN IF NOT EXISTS "locale" character varying(8) NOT NULL DEFAULT 'ko-KR'`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_healing_messages_active"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_healing_messages_active" ON "healing_messages" ("locale", "is_active")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_diary_questions_scope_cat_active"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_diary_questions_scope_cat_active" ON "diary_questions" ("locale", "scope", "category", "is_active")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_healing_messages_active"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_healing_messages_active" ON "healing_messages" ("is_active")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_diary_questions_scope_cat_active"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_diary_questions_scope_cat_active" ON "diary_questions" ("scope", "category", "is_active")`,
    );
    await queryRunner.query(
      `ALTER TABLE "healing_messages" DROP COLUMN "locale"`,
    );
    await queryRunner.query(
      `ALTER TABLE "diary_questions" DROP COLUMN "locale"`,
    );
  }
}
