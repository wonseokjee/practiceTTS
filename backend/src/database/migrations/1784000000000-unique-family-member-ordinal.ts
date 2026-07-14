import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M9: family_members 서수 인덱스를 UNIQUE로 승격.
 *
 * (profile_id, relation, relation_ordinal)은 페르소나 토큰([아들1])을 결정적으로
 * 만드는 키다. 중복되면 두 사람이 같은 토큰을 갖게 되어 역치환이 깨진다.
 *
 * M8에서는 비유니크로 두었다 — 당시 ProfileService.nextOrdinal이 count+1이라
 * 가족 삭제 후 서수가 충돌했고, UNIQUE를 걸면 운영에서만 실패했을 것이기 때문.
 * 채번을 MAX+1로 고쳐 서수 재사용이 사라졌으므로 이제 안전하게 승격한다.
 *
 * 주의: 기존 데이터에 중복 서수가 있으면 인덱스 생성이 실패한다. 그 경우
 * (profile_id, relation)별로 relation_ordinal을 재부여한 뒤 다시 실행해야 한다.
 */
export class UniqueFamilyMemberOrdinal1784000000000
  implements MigrationInterface
{
  name = 'UniqueFamilyMemberOrdinal1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_family_members_profile_relation_ord"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_family_members_profile_relation_ord"
        ON "family_members" ("profile_id", "relation", "relation_ordinal")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_family_members_profile_relation_ord"`,
    );
    await queryRunner.query(`
      CREATE INDEX "UQ_family_members_profile_relation_ord"
        ON "family_members" ("profile_id", "relation", "relation_ordinal")
    `);
  }
}
