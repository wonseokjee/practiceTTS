import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M22: 문항이 실제로 어떤 조건이었나 — qab_results.band_fallback / stimulus_kind.
 *
 * **왜 필요한가.** 두 값 다 "이 행의 `presented_level`이나 정답률을 어디까지
 * 믿을 수 있나"를 정한다. 지금은 둘 다 아무 데도 안 남아서, 집계가 조용히 틀린
 * 채로 맞는 것처럼 보인다.
 *
 * `band_fallback` — 뱅크는 레벨 밴드에 맞는 후보가 모자라면 범위를 풀어 세션이
 * 비지 않게 한다. 그 선택 자체는 옳다(문항이 사라지는 것보다 낫다). 문제는 그렇게
 * 나온 문항의 `presented_level`이 실제 난이도를 뜻하지 않는데 레벨별 집계는 그걸
 * 모른다는 것이다. 실측으로 글자 조합 3~4음절 풀이 28개뿐이라 세션 크기에 따라
 * 실제로 걸린다.
 *
 * `stimulus_kind` — 이름대기 자극의 33%(30/91)가 사진이 없어 SVG 아이콘으로
 * 떨어진다. 실물 사진과 만화풍 아이콘은 이름을 떠올리는 난이도가 달라서, 어느
 * 쪽이었는지 없으면 "이름대기 정답률"이 무엇을 잰 값인지 알 수 없다.
 *
 * **왜 컬럼인가(테이블이 아니라).** foil_kind와 같은 기준이다 — 같은 문항 시도의
 * **속성**이지 다른 종류의 사건이 아니다.
 *
 * **NULL이 정상이다.** 이 컬럼이 생기기 전의 모든 행, 그리고 해당 없는 하위검사가
 * NULL이다. `band_fallback`에 기본값 false를 넣지 않는 것이 중요하다 — 그러면
 * "모름"이 "폴백 아님"으로 바뀌어 없는 사실이 생긴다.
 *
 * **채점에 안 쓴다.** 정확도·레벨 판정은 이 값을 보지 않는다. 클라이언트가 보내는
 * 관측값이라(문항 뱅크가 프론트에 있어 서버가 되짚을 수 없다) 측정에 물리면 안 된다.
 */
export class AddQabPresentationContext1785200000000 implements MigrationInterface {
  name = 'AddQabPresentationContext1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
      ADD COLUMN "band_fallback" BOOLEAN,
      ADD COLUMN "stimulus_kind" VARCHAR(16)
    `);
    // 밴드 밖 행만 훑는 부분 인덱스 — "믿을 수 있는 행만"으로 거를 때 쓴다.
    await queryRunner.query(`
      CREATE INDEX "IDX_qab_results_band_fallback"
      ON "qab_results" ("patient_id", "subtest")
      WHERE "band_fallback" IS TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_qab_results_band_fallback"`);
    await queryRunner.query(`
      ALTER TABLE "qab_results"
      DROP COLUMN "stimulus_kind",
      DROP COLUMN "band_fallback"
    `);
  }
}
