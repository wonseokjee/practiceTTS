import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M31: 서비스 전체 일일 사용량 카운터 — daily_global_usage.
 *
 * **왜 필요한가.** M30의 가구별 상한은 계정 하나가 새는 것만 막는다. 계정을 여러
 * 개 만들거나 탈취된 계정이 여럿이면 합계가 무한정 커지고, ai-service의 회로차단기는
 * 분당·인메모리라 재시작마다 0이 된다. Gemini·Azure 청구서가 무한정 커지지 않도록
 * 하루 총량 천장을 둔다(첫 배포 전 비용 방어).
 *
 * UTC 날짜 × 종류마다 한 행이라 아주 작다. 복합 PK가 곧 조회 인덱스다.
 * 사용자 FK가 없다 — 서비스 전체 합계라 사용자 삭제와 무관하게 남아야 한다.
 */
export class CreateDailyGlobalUsage1786700000000 implements MigrationInterface {
  name = 'CreateDailyGlobalUsage1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "daily_global_usage" (
        "day" date NOT NULL,
        "kind" character varying(16) NOT NULL,
        "count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_daily_global_usage" PRIMARY KEY ("day", "kind"),
        CONSTRAINT "CHK_daily_global_usage_kind"
          CHECK ("kind" IN ('memory', 'quiz', 'scenario', 'conversation', 'stt', 'pronunciation', 'tts'))
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "daily_global_usage"`);
  }
}
