import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M18: 적응형 스킬 레벨링 — skill_levels 테이블 + qab_results.presented_level.
 *
 * 환자별×스킬(QAB 서브테스트)별 1~5단계 난이도를 저장한다. 레벨은 매 제출마다
 * 현재 레벨에서 제시된 최근 윈도우 정확도로 재계산되는 파생값이라(멱등),
 * 상태 자체는 단일 UPSERT 행으로 충분하다.
 *
 * presented_level: 각 qab_results 항목이 "몇 레벨에서 제시됐는지"를 기록한다.
 * 이게 없으면 승급 직후 어려워진 창의 유도된 정확도 하락을 퇴행으로 오독해
 * 강등→진동한다. nullable로 두어 컬럼 추가 이전의 구데이터와 호환한다.
 */
export class CreateSkillLevels1784800000000 implements MigrationInterface {
  name = 'CreateSkillLevels1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "skill_levels" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" uuid NOT NULL,
        "subtest" character varying(16) NOT NULL,
        "level" smallint NOT NULL DEFAULT 2,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skill_levels" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_skill_levels_patient_subtest" UNIQUE ("patient_id", "subtest"),
        CONSTRAINT "CHK_skill_levels_level_range" CHECK ("level" >= 1 AND "level" <= 5),
        CONSTRAINT "FK_skill_levels_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ADD COLUMN "presented_level" smallint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "qab_results" DROP COLUMN "presented_level"`,
    );
    await queryRunner.query(`DROP TABLE "skill_levels"`);
  }
}
