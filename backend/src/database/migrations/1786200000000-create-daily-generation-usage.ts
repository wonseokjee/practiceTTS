import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M30: 일일 생성 사용량 카운터 — daily_generation_usage.
 *
 * **왜 필요한가.** 창립 회원은 1년 무료이고 한국어판도 전부 무료다. 생성 경로
 * (기억 등록·퀴즈 생성/재생성·시나리오·대화 메시지)는 매번 LLM을 부르는데, 지금은
 * 인메모리 `@RateLimit`뿐이라 **재시작마다 0**이 된다(pm2 재시작·배포). 한 계정이
 * 하루에 몇 번을 부르든 막을 방법이 없다(실행 계획 §13 OV-4A).
 *
 * **왜 행 수가 아니라 카운터인가(OV-A).** 처음 계획은 "오늘 만든 행 수"를 세는
 * 것이었지만 두 경로가 원리상 행을 안 남긴다 — 수동 재생성은 기존 quiz_sets를
 * 지우고 새로 만들고, 시나리오는 memory_entries의 캐시 컬럼만 갱신한다. 그래서
 * 호출 전에 `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING`으로
 * 원자적으로 올리고 상한과 비교한다. 동시 요청 둘이 같은 값을 읽고 둘 다 통과하는
 * 경합이 없다.
 *
 * **day는 환자 로컬 날짜다.** `week-boundary.ts`의 `dayBucket`으로 자른다 —
 * 보호자 화면의 "오늘"과 상한의 "오늘"이 같은 식이어야 한다.
 *
 * 복합 PK가 곧 조회 인덱스다. 행은 환자 × 날 × 종류마다 하나라 작다.
 */
export class CreateDailyGenerationUsage1786200000000 implements MigrationInterface {
  name = 'CreateDailyGenerationUsage1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "daily_generation_usage" (
        "patient_id" uuid NOT NULL,
        "day" date NOT NULL,
        "kind" character varying(16) NOT NULL,
        "count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_daily_generation_usage"
          PRIMARY KEY ("patient_id", "day", "kind"),
        CONSTRAINT "CHK_daily_generation_usage_kind"
          CHECK ("kind" IN ('memory', 'quiz', 'scenario', 'conversation')),
        CONSTRAINT "FK_daily_generation_usage_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "daily_generation_usage"`);
  }
}
