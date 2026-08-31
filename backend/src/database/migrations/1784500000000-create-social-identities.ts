import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M14: 계정 병합 1단계 — user_social_identities 신설.
 *
 * 20260727_AccountMerge_feature_plan §1.
 * users는 (auth_provider, provider_user_id)를 각 1개만 갖는다("최초/주 provider").
 * 계정 병합은 "유저 1명 ↔ 로그인 수단 여러 개"라, 재방문 로그인 조회의 근거를
 * 이 테이블로 옮긴다. 기존 소셜 유저는 백필로 identity 1행씩 만든다.
 *
 * 멱등: dev는 synchronize(!isProduction)가 엔티티를 먼저 반영해 테이블/인덱스가
 * 이미 있을 수 있다. 모든 DDL에 IF NOT EXISTS를 쓰고, 백필도 ON CONFLICT DO
 * NOTHING으로 중복 삽입을 흡수한다.
 */
export class CreateSocialIdentities1784500000000 implements MigrationInterface {
  name = 'CreateSocialIdentities1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_social_identities" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "provider" VARCHAR(20) NOT NULL,
        "provider_user_id" VARCHAR NOT NULL,
        "email" VARCHAR NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_social_identities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_social_identity_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // (provider, provider_user_id): 한 소셜 계정은 한 유저에만 연결된다.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_identity_provider_account"
        ON "user_social_identities" ("provider", "provider_user_id")
    `);
    // (user_id, provider): 한 유저는 같은 provider를 하나만 붙인다(카카오1+구글1).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_identity_user_provider"
        ON "user_social_identities" ("user_id", "provider")
    `);

    // 백필: 기존 소셜 유저(auth_provider != 'local', provider_user_id 보유)를
    // identity 1행으로 옮긴다. 재실행/부분적용 대비 ON CONFLICT DO NOTHING.
    await queryRunner.query(`
      INSERT INTO "user_social_identities"
        ("user_id", "provider", "provider_user_id", "email")
      SELECT "id", "auth_provider", "provider_user_id", "email"
      FROM "users"
      WHERE "auth_provider" <> 'local'
        AND "provider_user_id" IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 로그인 조회가 이 테이블로 이관됐다. 소셜 유저가 있으면 드롭 시 로그인
    // 불능이 되므로 되돌리기를 거부한다(M13 down과 동일한 안전장치).
    const socialRows: unknown = await queryRunner.query(
      `SELECT 1 FROM "user_social_identities" LIMIT 1`,
    );
    if (Array.isArray(socialRows) && socialRows.length > 0) {
      throw new Error(
        '연결된 소셜 계정이 존재해 이 마이그레이션을 되돌릴 수 없습니다. ' +
          'user_social_identities를 드롭하면 해당 계정이 로그인 불능이 됩니다. ' +
          '먼저 소셜 계정을 정리한 뒤 다시 시도하세요.',
      );
    }
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_identity_user_provider"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_identity_provider_account"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_social_identities"`);
  }
}
