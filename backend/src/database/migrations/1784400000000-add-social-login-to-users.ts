import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M13: 소셜 로그인(카카오·구글) 지원을 위한 users 확장.
 *
 * 20260726_SocialLogin_feature_plan §3.
 *  - auth_provider: 'local'(기존) | 'kakao' | 'google'. 기존 행은 DEFAULT 'local'로 채움.
 *  - provider_user_id: 소셜 계정 고유 ID. (auth_provider, provider_user_id)로 재방문 매칭.
 *  - email/password_hash: 소셜 유저는 없을 수 있어 NOT NULL 해제.
 *  - 부분 고유 인덱스: 같은 (provider, id) 소셜 계정 중복 방지. provider_user_id가
 *    NULL인 로컬 계정 다수는 인덱스 대상에서 제외(WHERE ... IS NOT NULL).
 */
export class AddSocialLoginToUsers1784400000000 implements MigrationInterface {
  name = 'AddSocialLoginToUsers1784400000000';

  // 멱등 작성: dev는 synchronize(!isProduction)가 엔티티 변경을 먼저 반영해
  // 컬럼이 이미 존재할 수 있다. prod(synchronize off)에선 새로 추가한다.
  // 두 경우 모두 안전하도록 IF NOT EXISTS / 무해한 DROP NOT NULL을 쓴다.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "auth_provider" character varying(20) NOT NULL DEFAULT 'local',
        ADD COLUMN IF NOT EXISTS "provider_user_id" character varying
    `);

    // 소셜 유저는 이메일/비밀번호가 없을 수 있다. (이미 nullable이면 무해)
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "email" DROP NOT NULL,
        ALTER COLUMN "password_hash" DROP NOT NULL
    `);

    // (provider, provider_user_id) 조합은 유일해야 한다. 단, 로컬 계정은
    // provider_user_id가 NULL이므로 부분 인덱스로 제외한다.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_provider_account"
        ON "users" ("auth_provider", "provider_user_id")
        WHERE "provider_user_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_users_provider_account"`,
    );

    // 소셜 유저가 이미 있으면 되돌리기를 거부한다. auth_provider·provider_user_id를
    // 드롭하면 그들의 제공자 신원이 사라지고, email/password도 NULL이라 로그인이
    // 영구 불능이 된다. 롤백은 소셜 계정을 먼저 정리(이관/삭제)한 뒤 수행해야 한다.
    const socialRows = await queryRunner.query(
      `SELECT 1 FROM "users" WHERE "auth_provider" <> 'local' LIMIT 1`,
    );
    if (Array.isArray(socialRows) && socialRows.length > 0) {
      throw new Error(
        '소셜 유저가 존재해 이 마이그레이션을 되돌릴 수 없습니다. ' +
          'auth_provider/provider_user_id를 드롭하면 해당 계정이 로그인 불능이 됩니다. ' +
          '먼저 소셜 계정을 이관하거나 삭제한 뒤 다시 시도하세요.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "email" SET NOT NULL,
        ALTER COLUMN "password_hash" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "provider_user_id",
        DROP COLUMN "auth_provider"
    `);
  }
}
