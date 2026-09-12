import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M28: `qab_results.answered_at` — 문항을 **푼** 시각.
 *
 * 영어판 실행 계획 §14(엔지니어링 재검토, 2026-09-12) R1의 남은 부분이다
 * (컬럼 셋은 M27로 끝났다, §15-2).
 *
 * ## 왜 `created_at`으로는 안 되나
 *
 * `created_at`은 **서버가 행을 받은** 시각이다. 지금은 세션이 끝날 때 바로
 * 보내므로 둘이 같지만, 오프라인 재전송(공유 `QabOutbox`, R7)이 들어오면
 * 갈라진다 — 월요일에 푼 결과가 수요일에 도착하면 `created_at` 기준 집계는
 * 그 수행을 수요일로 센다. 활동일·주간 추이·재출제 우선순위가 전부 하루씩,
 * 주 경계를 넘으면 한 주씩 틀린다. 틀려도 숫자는 그럴듯하게 나온다.
 *
 * 그래서 시간 축은 "푼 때"를 담는 별도 컬럼으로 옮긴다(R2, OV-D). 이 마이그레이션은
 * 그 컬럼을 만들 뿐이다.
 *
 * ## 소급은 `created_at`
 *
 * 지금까지의 행은 전부 "풀자마자 보냈다" — 재전송 경로가 없었다. 그래서 기존 행의
 * `answered_at = created_at`은 추정이 아니라 **그때의 사실**이다. 계획의
 * REGRESSION RULE 1("소급 뒤 다섯 쿼리 결과가 전과 같다")이 이 등식에 기댄다.
 *
 * 컬럼을 `DEFAULT now()`로 한 번에 추가하면 **기존 행이 전부 마이그레이션 시각으로
 * 채워진다**(Postgres가 기본값을 기존 행에 적용한다). 과거 수행이 한날로 몰리므로
 * 추가 → 소급 → 기본값·NOT NULL 순으로 나눈다.
 *
 * `created_at`이 이미 timestamptz라 변환이 없다 — TIMESTAMP → TIMESTAMPTZ에서
 * 9시간 밀렸던 사고(c337dc5)와 같은 함정이 여기엔 없다.
 *
 * ## 기본값 `now()`
 *
 * 클라이언트가 시각을 보내는 계약(OV-B, R3·R4)은 아직 없다. 그 전까지 제출 경로는
 * 이 컬럼을 채우지 않고, 기본값이 `created_at`과 **같은 트랜잭션 시각**을 넣는다.
 * 그래서 이 마이그레이션은 동작을 바꾸지 않는다. 계약이 들어오면 옛 클라이언트의
 * 폴백이 그대로 이 기본값이다("없으면 서버 시각", OV-B).
 *
 * ## 인덱스
 *
 * 시간 축 쿼리는 전부 `patient_id = ? AND answered_at >= ?` 모양이다(계획 4-1:
 * 이 테이블의 시간 축에 인덱스가 없었다). 부분 인덱스가 아니다 — 모든 행이 대상이다.
 */
export class AddAnsweredAtToQabResults1786000000000 implements MigrationInterface {
  name = 'AddAnsweredAtToQabResults1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ADD COLUMN IF NOT EXISTS "answered_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      UPDATE "qab_results"
         SET "answered_at" = "created_at"
       WHERE "answered_at" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ALTER COLUMN "answered_at" SET DEFAULT now(),
        ALTER COLUMN "answered_at" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_qab_results_patient_answered"
        ON "qab_results" ("patient_id", "answered_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_qab_results_patient_answered"`,
    );
    await queryRunner.query(`
      ALTER TABLE "qab_results" DROP COLUMN IF EXISTS "answered_at"
    `);
  }
}
