import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M35: 녹음과 문항 결과를 잇는다 — `speech_recordings.clip_id` · `qab_results.clip_id` ·
 * `qab_results.caregiver_corrected`.
 *
 * 자체 ASR 학습셋의 라벨 필터는 Azure 점수나 인식 결과로 고른다. 그러면 **Azure가 이미 알아들은
 * 발화만** 남고, 자체 ASR이 정작 필요한 발화(Azure가 못 알아듣는 발화)는 버려진다(검토 문서 G1).
 * 사람 판정이 그 빈칸을 메운다. 보호자는 이미 퀴즈에서 자동 채점을 정정하지만, 그 판정이
 * 어느 녹음에 대한 것인지 남지 않았다.
 *
 * 앱이 녹음마다 클립 식별자(UUID)를 만들어 오디오와 함께 올리고, 같은 값을 문항 결과에도 싣는다.
 * 학습셋을 만들 때 `clip_id`로 둘을 잇는다. 외래키는 걸지 않는다 — 녹음은 동의한 환자만 남고
 * 언제든 지워지지만 문항 결과는 남아야 하므로, 한쪽만 있는 것이 정상이다.
 *
 * `caregiver_corrected`: 보호자가 이 문항의 자동 판정을 바꿨으면 TRUE. NULL은 바꾸지 않았거나
 * 컬럼 이전의 행이다(정정이 있는 행만 뜻이 있어 FALSE로 채우지 않는다). 관측값이라 채점에 쓰지 않는다.
 *
 * M33·M34와 같은 결정: 널 허용, 기본값 없음, 소급 없음.
 */
export class AddSpeechClipLink1786900000000 implements MigrationInterface {
  name = 'AddSpeechClipLink1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "speech_recordings"
        ADD COLUMN IF NOT EXISTS "clip_id" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_speech_recordings_clip"
        ON "speech_recordings" ("clip_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ADD COLUMN IF NOT EXISTS "clip_id" uuid,
        ADD COLUMN IF NOT EXISTS "caregiver_corrected" boolean
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        DROP COLUMN IF EXISTS "caregiver_corrected",
        DROP COLUMN IF EXISTS "clip_id"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_speech_recordings_clip"`,
    );
    await queryRunner.query(`
      ALTER TABLE "speech_recordings"
        DROP COLUMN IF EXISTS "clip_id"
    `);
  }
}
