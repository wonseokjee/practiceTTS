import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M29: M21·M22의 부분 인덱스를 잃은 DB에 되살린다.
 *
 * **무슨 일이 있었나.** M21(`IDX_qab_results_foil_kind`)과 M22
 * (`IDX_qab_results_band_fallback`)는 인덱스를 만들었지만 엔티티에 `@Index` 선언이
 * 없었다. 그러면 TypeORM은 그 인덱스를 "엔티티에 없는 것"으로 보고 동기화 때
 * 지운다. 개발 DB에서는 실제로 지워졌다 — 마이그레이션 기록은 둘 다 적용으로 남은
 * 채 인덱스만 없었고, 그 뒤로 `schema:log`는 드리프트 0을 보고했다(엔티티도 DB도
 * 둘 다 없었으니까). 운영 DB가 어느 쪽인지는 모른다.
 *
 * 빈 DB에서 전체 체인을 돌리는 통합 테스트(`test/int/migrations.int-spec.ts`)가
 * 처음으로 두 DB의 차이를 드러냈다. 같은 커밋에서 엔티티에 선언을 넣었다.
 *
 * **IF NOT EXISTS.** 인덱스가 남아 있는 DB(빈 DB에서 새로 만든 곳, 아마 운영)에서는
 * 아무것도 안 한다. 정의는 M21·M22 원문 그대로다.
 *
 * **down은 비워 둔다.** 이 인덱스들의 주인은 M21·M22다. 여기서 되돌린다고 지우면
 * 인덱스가 원래 있던 DB에서도 사라져, 되돌리기 전보다 나쁜 상태가 된다.
 */
export class RestoreQabPartialIndexes1786100000000 implements MigrationInterface {
  name = 'RestoreQabPartialIndexes1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_qab_results_foil_kind"
      ON "qab_results" ("patient_id", "foil_kind")
      WHERE "foil_kind" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_qab_results_band_fallback"
      ON "qab_results" ("patient_id", "subtest")
      WHERE "band_fallback" IS TRUE
    `);
  }

  public async down(): Promise<void> {
    // 의도적으로 비움 — 위 주석 참조.
  }
}
