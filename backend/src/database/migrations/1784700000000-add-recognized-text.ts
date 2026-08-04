import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M16: 보존 발화에 '인식 가설(recognized_text)' 추가 — 라벨 오염 방지.
 *
 * target_text(= 환자에게 말하라고 제시한 목표)는 정답 라벨로 쓰였지만, 이 앱의
 * 대상(구음장애·실어증)은 목표와 다르게 발화하는 경우가 많다. 그러면 오디오와
 * 라벨이 어긋난 오염 쌍이 학습셋에 섞인다.
 *
 * recognized_text에 ASR이 실제로 들은 전사(가설)를 함께 저장하면, 학습셋 빌드 시
 *  - target_text ≈ recognized_text 인 것만(라벨 신뢰) 고르거나,
 *  - score(발음 점수) 임계 이상만 고르는 식으로 오염을 걸러낼 수 있다.
 * 데이터를 버리지 않고 품질 메타만 남기는 접근(약라벨 보존).
 *
 * score 컬럼은 M15에서 이미 존재하므로 여기서는 recognized_text만 추가한다.
 */
export class AddRecognizedText1784700000000 implements MigrationInterface {
  name = 'AddRecognizedText1784700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "speech_recordings"
        ADD COLUMN IF NOT EXISTS "recognized_text" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "speech_recordings"
        DROP COLUMN IF EXISTS "recognized_text"
    `);
  }
}
