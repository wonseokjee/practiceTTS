import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M19: 세션 완료 마커 — qab_session_completions.
 *
 * ADP-001(점진 제출)로 문항별 부분 저장은 이미 쌓이지만, "세션이 끝까지
 * 진행됐는지(완료) vs 중간에 떠났는지(이탈)"를 구분할 방법이 없었다. 이 테이블은
 * session_token당 1행만 두는 최소 마커다 — qab_results에 행이 있는데 여기 없으면
 * 이탈이다. 보호자 대시보드의 완료율/이탈 통계가 이 테이블을 기반으로 한다
 * (통계 조회 자체는 후속).
 */
export class CreateQabSessionCompletions1784900000000
  implements MigrationInterface
{
  name = 'CreateQabSessionCompletions1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "qab_session_completions" (
        "session_token" uuid NOT NULL,
        "patient_id" uuid NOT NULL,
        "completed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_qab_session_completions" PRIMARY KEY ("session_token"),
        CONSTRAINT "FK_qab_session_completions_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_qab_session_completions_patient"
        ON "qab_session_completions" ("patient_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "qab_session_completions"`);
  }
}
