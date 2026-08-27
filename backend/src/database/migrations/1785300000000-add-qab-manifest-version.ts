import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M23: 이 행이 어느 문항 풀 기준인가 — qab_results.manifest_version.
 *
 * **왜 필요한가.** `presented_level`은 "레벨 3에서 제시했다"만 말하고, 그 3이
 * 무엇을 뜻하는지는 그때의 문항 풀이 정한다. 풀이 바뀌면 같은 숫자가 다른 난이도가
 * 된다.
 *
 * 프론트는 이미 매 제출에 `manifestVersion`을 실어 보내고 있었다. 백엔드는 그걸
 * 받아 **서버 값과 다르면 경고만 찍고 버렸다.** 그래서 상수 주석에
 * "v2의 presented_level과 v3의 것은 같은 축이 아니다. 이 버전 값이 그 경계를
 * 표시한다"라고 적혀 있는데, 정작 경계를 표시할 곳이 없었다 — 어느 행이 어느
 * 버전인지 되짚을 방법이 전혀 없다.
 *
 * 보호자 화면의 회복 추세는 주차별 정답률이다. 문항 풀이 바뀐 주에 생기는 계단은
 * 회복도 악화도 아닌 **정의 변경**인데, 이 컬럼이 없으면 그 둘을 구분할 수 없다.
 *
 * **NULL이 정상이다** — 컬럼 이전의 모든 행, 그리고 버전을 안 보낸 옛 클라이언트.
 * 기본값을 채워 "모름"을 특정 버전으로 바꾸면 없는 사실이 생긴다.
 *
 * **채점에 안 쓴다.** foil_kind·band_fallback과 같은 성격의 관측값이다.
 */
export class AddQabManifestVersion1785300000000 implements MigrationInterface {
  name = 'AddQabManifestVersion1785300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
      ADD COLUMN "manifest_version" SMALLINT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
      DROP COLUMN "manifest_version"
    `);
  }
}
