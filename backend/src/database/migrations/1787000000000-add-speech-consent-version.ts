import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M36: 음성 데이터 동의에 **무엇에, 누가** 동의했는지 남긴다 — `users.speech_data_consent_version` ·
 * `users.speech_data_consent_by`.
 *
 * 지금까지는 동의 시각만 남아, 문구가 바뀌면 이전 동의자가 어느 문구에 동의했는지 알 수 없었다
 * (검토 문서 G3). 제품 결정(검토 문서 3a)으로 동의는 보호자가 환자를 대신해 하므로, 동의한 계정도 남긴다.
 *
 *  - speech_data_consent_version: 앱이 화면에 보여 준 문구의 버전(로케일 포함, 예 `ko-KR-2026-10-24`).
 *    NULL은 동의하지 않았거나 이 컬럼 이전의 동의다(이전 문구 — 소급하지 않는다).
 *  - speech_data_consent_by: 스위치를 켠 계정(보호자 또는 환자 본인). 외래키는 걸지 않는다 —
 *    보호자 계정이 지워져도 동의 기록은 남아야 한다.
 *
 * 둘 다 동의를 끄면 NULL로 돌아간다(speech_data_consent_at과 같은 규칙).
 */
export class AddSpeechConsentVersion1787000000000 implements MigrationInterface {
  name = 'AddSpeechConsentVersion1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "speech_data_consent_version" varchar(32),
        ADD COLUMN IF NOT EXISTS "speech_data_consent_by" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "speech_data_consent_by",
        DROP COLUMN IF EXISTS "speech_data_consent_version"
    `);
  }
}
