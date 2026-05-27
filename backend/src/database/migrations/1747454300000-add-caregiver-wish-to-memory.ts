import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M1: memory_entries.caregiver_wish_message 컬럼 추가 (Phase 6 사전 준비)
 *
 * - PostgreSQL 11+에서 ADD COLUMN NULL은 메타데이터 변경만으로 즉시 완료 (무중단)
 * - 기본값 미지정 → 기존 row 재작성 없음
 * - DROP COLUMN은 데이터 영구 손실 → 운영 적용 시 별도 백업 절차 필요
 */
export class AddCaregiverWishToMemory1747454300000 implements MigrationInterface {
  name = 'AddCaregiverWishToMemory1747454300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "caregiver_wish_message" TEXT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "memory_entries" DROP COLUMN IF EXISTS "caregiver_wish_message"`,
    );
  }
}
