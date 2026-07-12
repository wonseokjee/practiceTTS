import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M7: 환자 프로필(가족 페르소나) 2개 테이블 신설
 *   1. patient_profiles (환자당 1개; patient_id UNIQUE)
 *   2. family_members   (환자당 N개; FK → patient_profiles CASCADE)
 *
 * 스키마는 엔티티(patient-profile.entity.ts / family-member.entity.ts)를 충실히
 * 반영한다. patient_id/caregiver_id는 엔티티가 관계(@ManyToOne)를 선언하지 않아
 * users FK를 두지 않는다(synchronize 산출물과 일치). profile_id만 CASCADE FK.
 *
 * name/note/notes는 서비스 레이어에서 AES-256 암호화되어 저장되므로 컬럼은 평문
 * 타입(text)이되 원문은 DB에 남지 않는다. UNIQUE 제약은 엔티티의 @Index(unique)에
 * 맞춰 UNIQUE INDEX로 생성한다.
 */
export class CreatePatientProfileTables1783900000000
  implements MigrationInterface
{
  name = 'CreatePatientProfileTables1783900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) patient_profiles (환자당 1개)
    await queryRunner.query(`
      CREATE TABLE "patient_profiles" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" UUID NOT NULL,
        "caregiver_id" UUID NOT NULL,
        "hometown" VARCHAR(100) NULL,
        "occupation" VARCHAR(100) NULL,
        "hobbies" JSONB NOT NULL DEFAULT '[]',
        "significant_places" JSONB NOT NULL DEFAULT '[]',
        "notes" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient_profiles" PRIMARY KEY ("id")
      )
    `);
    // 환자당 프로필 1개 보장
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_patient_profiles_patient"
        ON "patient_profiles" ("patient_id")
    `);

    // 2) family_members (환자당 N개)
    await queryRunner.query(`
      CREATE TABLE "family_members" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "profile_id" UUID NOT NULL,
        "relation" VARCHAR(20) NOT NULL,
        "name" TEXT NOT NULL,
        "gender" VARCHAR(1) NOT NULL DEFAULT 'U',
        "relation_ordinal" SMALLINT NOT NULL DEFAULT 1,
        "note" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_family_members" PRIMARY KEY ("id"),
        CONSTRAINT "FK_family_members_profile"
          FOREIGN KEY ("profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE
      )
    `);
    // 동일 관계 내 서수로 토큰([아들1])을 결정적으로 생성 — 중복 방지
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_family_members_profile_relation_ord"
        ON "family_members" ("profile_id", "relation", "relation_ordinal")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // FK 의존 역순으로 DROP (family_members → patient_profiles)
    await queryRunner.query(`DROP TABLE IF EXISTS "family_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "patient_profiles"`);
  }
}
