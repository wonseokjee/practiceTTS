import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M25: 이름대기 단서 위계 — `qab_results.cue_level`.
 *
 * **왜 불리언으로 부족한가.** 지금은 도움이 `assisted BOOLEAN` 하나다. 첫 소리만
 * 들으면 말할 수 있는 환자와 아무리 해도 못 말하는 환자가 같은 기록을 남긴다.
 * 게다가 모든 통계가 `NOT r.assisted`로 걸러서(quiz.service.ts) **단서를 매번
 * 받는 환자는 데이터가 0**이다. 회복 중이어도 화면에 아무것도 안 나타난다.
 *
 * 단서 위계에서 재는 값은 "몇 %"가 아니라 **"얼마나 도와야 했나"** 다. 그래서
 * 도움의 양 자체를 남긴다.
 *
 *   NULL  단서 개념이 없는 하위검사(이름대기 외 전부), 그리고 이 기능 이전의 기록
 *   0     무단서 정답
 *   1     의미 단서를 받고 정답      ("동물이에요")
 *   2     (문장 완성 — 아직 없다)
 *   3     음소 단서를 받고 정답      ("사…" / "첫소리는 시옷이에요")
 *   4     통과 — 정답을 알려줬다
 *
 * 2번을 비워 둔 이유는 namingCue.ts에 적어 뒀다. 요약하면, 나중에 문장 완성이
 * 들어올 때 3·4를 당기면 그 전에 쌓인 기록의 뜻이 바뀐다.
 *
 * **`assisted`는 지운다는 뜻이 아니다.** `cue_level >= 1`이면 `assisted = true`를
 * 함께 쓴다. 기존 통계 쿼리 세 곳이 그대로 동작해야 이 마이그레이션이 무해하다.
 *
 * **과거 기록은 채우지 않는다.** `assisted` 불리언만으로는 몇 단계였는지 복원할
 * 수 없다. 없는 값을 0으로 메우면 "예전엔 단서 없이 다 맞혔다"는 거짓 회복
 * 곡선이 그려진다. NULL로 두고 그래프에서 뺀다.
 */
export class AddQabCueLevel1785500000000 implements MigrationInterface {
  name = 'AddQabCueLevel1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
      ADD COLUMN "cue_level" SMALLINT
    `);
    // 값 범위를 DB가 지킨다. 사다리에 없는 2도 허용한다 — 문장 완성이 들어오면
    // 그때 쓸 자리라, 그 하나 때문에 마이그레이션을 또 돌리지 않는다.
    await queryRunner.query(`
      ALTER TABLE "qab_results"
      ADD CONSTRAINT "CHK_qab_results_cue_level"
      CHECK ("cue_level" IS NULL OR ("cue_level" >= 0 AND "cue_level" <= 4))
    `);
    // 이름대기 추세는 이 컬럼만 훑는다. 값이 있는 행이 일부라 부분 인덱스로 둔다
    // (M21의 foil_kind와 같은 이유).
    await queryRunner.query(`
      CREATE INDEX "IDX_qab_results_cue_level"
      ON "qab_results" ("patient_id", "created_at")
      WHERE "cue_level" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_qab_results_cue_level"`);
    await queryRunner.query(
      `ALTER TABLE "qab_results" DROP CONSTRAINT IF EXISTS "CHK_qab_results_cue_level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "qab_results" DROP COLUMN IF EXISTS "cue_level"`,
    );
  }
}
