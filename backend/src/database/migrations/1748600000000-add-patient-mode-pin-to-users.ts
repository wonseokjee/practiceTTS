import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * users.patient_mode_pin_hash 컬럼 추가 (보호자 단일 계정 모델)
 *
 * - 환자 모드 → 보호자 복귀 시 4자리 PIN 검증용 bcrypt 해시 (보호자에만 설정)
 * - ADD COLUMN NULL → PostgreSQL 11+에서 메타데이터 변경만으로 즉시 완료 (무중단)
 * - DROP COLUMN은 데이터 영구 손실 → 운영 적용 시 별도 백업 절차 필요
 */
export class AddPatientModePinToUsers1748600000000 implements MigrationInterface {
  name = 'AddPatientModePinToUsers1748600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "patient_mode_pin_hash" VARCHAR NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "patient_mode_pin_hash"`,
    );
  }
}
