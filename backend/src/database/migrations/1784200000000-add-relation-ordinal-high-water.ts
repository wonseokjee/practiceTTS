import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M11: patient_profiles.relation_ordinal_high_water 추가.
 *
 * 가족 서수는 페르소나 토큰([아들1])의 키다. 옛 시나리오·퀴즈는 토큰 상태로
 * 저장돼 표시 시점에 현재 프로필로 역치환되므로, 서수를 재사용하면 옛 기억이
 * **다른 가족의 이름으로** 복원된다.
 *
 * 채번은 살아있는 행의 MAX+1이었는데, 해당 관계의 구성원을 전원 삭제하면
 * MAX가 NULL이 되어 카운터가 1로 되돌아갔다. 삭제돼도 남는 최고 수위를
 * 이 컬럼에 보존한다.
 *
 * 기존 프로필은 현재 살아있는 서수의 MAX로 백필한다 — 그보다 위로 발급된
 * 서수의 기록은 남아있지 않지만, 최소한 지금 존재하는 구성원과의 충돌은 막는다.
 */
export class AddRelationOrdinalHighWater1784200000000
  implements MigrationInterface
{
  name = 'AddRelationOrdinalHighWater1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patient_profiles"
         ADD COLUMN IF NOT EXISTS "relation_ordinal_high_water" JSONB NOT NULL DEFAULT '{}'`,
    );

    // 현재 구성원의 관계별 MAX 서수로 백필
    await queryRunner.query(`
      UPDATE "patient_profiles" p
         SET "relation_ordinal_high_water" = COALESCE(m.high_water, '{}'::jsonb)
        FROM (
          SELECT "profile_id",
                 jsonb_object_agg("relation", max_ordinal) AS high_water
            FROM (
              SELECT "profile_id", "relation", MAX("relation_ordinal") AS max_ordinal
                FROM "family_members"
               GROUP BY "profile_id", "relation"
            ) per_relation
           GROUP BY "profile_id"
        ) m
       WHERE p."id" = m."profile_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patient_profiles" DROP COLUMN IF EXISTS "relation_ordinal_high_water"`,
    );
  }
}
