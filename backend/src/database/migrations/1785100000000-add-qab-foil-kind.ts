import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M21: 단어이해 오답의 갈래 — qab_results.foil_kind.
 *
 * **왜 필요한가.** 보호자 화면은 "단어 이해 정답률 24%"까지만 말한다. 그 24%가
 * 의미를 못 잡아서인지 소리를 못 잡아서인지는 말하지 못하는데, 실어증에서 그 둘은
 * 다른 손상이고 재활에서 다른 대응을 부른다.
 *
 * `LEVEL_CHOICE_SPEC`(word-foil-axis, #59)이 오답을 의미 유인지와 음운 유인지로
 * 갈라 내기 시작했다. 갈라서 내놓고 어느 쪽을 골랐는지 안 남기면 그 구분이 화면까지
 * 오지 못한다. 이 컬럼이 그 통로다.
 *
 * **왜 컬럼인가(테이블이 아니라).** practice_results를 나눌 때 쓴 기준 그대로다 —
 * 모양이 같으면 컬럼, 다르면 테이블. 이건 같은 문항 시도의 **속성 하나**이지 다른
 * 종류의 사건이 아니다. attempt 축도, NULL 정오답도 필요 없다.
 *
 * **NULL이 정상이다.** 맞힌 문항, 단어이해가 아닌 하위검사, 그리고 이 컬럼이 생기기
 * 전의 모든 행이 NULL이다. 집계는 NULL을 세지 않는 쪽으로 쓴다 — 기본값을 넣어
 * "모름"을 "무관"으로 바꾸면 없는 사실이 생긴다.
 *
 * **채점에 안 쓴다.** 정확도·레벨 재계산은 이 값을 보지 않는다. 클라이언트가 보내는
 * 관측값이라(presented_level과 달리 서버가 되짚을 수 없다 — 낱말 뱅크가 프론트에
 * 있다) 측정에 물리면 안 된다. 물리지 않으므로 조작해도 성적이 안 움직인다.
 */
export class AddQabFoilKind1785100000000 implements MigrationInterface {
  name = 'AddQabFoilKind1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
      ADD COLUMN "foil_kind" VARCHAR(16)
    `);
    // 갈래별 집계가 단어이해 행만 훑도록. 전체 행의 일부만 값이 있어 부분 인덱스로 둔다.
    await queryRunner.query(`
      CREATE INDEX "IDX_qab_results_foil_kind"
      ON "qab_results" ("patient_id", "foil_kind")
      WHERE "foil_kind" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_qab_results_foil_kind"`);
    await queryRunner.query(
      `ALTER TABLE "qab_results" DROP COLUMN IF EXISTS "foil_kind"`,
    );
  }
}
