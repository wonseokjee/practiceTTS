import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M15: 음성 데이터 보존(동의 기반) 지원.
 *
 * 자체 구음장애 ASR 학습을 위해, 동의한 환자의 훈련 발화를 보존한다. 목표 문장이
 * 정답 라벨이므로 (오디오 + target_text + patient_id) = 지도학습 데이터 그대로다.
 *
 *  - users.speech_data_consent: 환자 음성 보존 동의(opt-in, 기본 false). 미동의면
 *    발화는 채점 후 즉시 폐기(현행)된다.
 *  - users.speech_data_consent_at: 동의 시각(철회 시 NULL).
 *  - speech_recordings: 보존된 발화 1건. audio_path는 파일 스토리지 경로.
 *    삭제 요구 시 patient_id로 조각만 지우면 되도록 화자별로 분리(컴플라이언스).
 */
export class AddSpeechDataConsent1784600000000 implements MigrationInterface {
  name = 'AddSpeechDataConsent1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "speech_data_consent" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "speech_data_consent_at" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "speech_recordings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" uuid NOT NULL,
        "task" character varying(16) NOT NULL,
        "target_text" text NOT NULL,
        "audio_path" character varying(500) NOT NULL,
        "duration_ms" integer,
        "score" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_speech_recordings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_speech_recordings_patient" FOREIGN KEY ("patient_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_speech_recordings_patient"
        ON "speech_recordings" ("patient_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "speech_recordings"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "speech_data_consent_at",
        DROP COLUMN IF EXISTS "speech_data_consent"
    `);
  }
}
