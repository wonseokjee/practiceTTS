import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M10: quiz_sets.generation_attempts 추가.
 *
 * 부팅 복구가 failed QuizSet을 재시도하되, 노트 부족(422)처럼 영원히 실패할
 * 콘텐츠가 매 부팅마다 LLM을 때리지 않도록 시도 횟수 상한의 근거가 된다.
 *
 * 기존 행은 0으로 채운다 — 한 번은 재시도해볼 가치가 있다(대부분 일시 오류로
 * 실패했을 것이고, 영구 실패라면 상한까지 시도한 뒤 자연히 멈춘다).
 */
export class AddGenerationAttemptsToQuizSets1784100000000
  implements MigrationInterface
{
  name = 'AddGenerationAttemptsToQuizSets1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quiz_sets"
         ADD COLUMN IF NOT EXISTS "generation_attempts" SMALLINT NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quiz_sets" DROP COLUMN IF EXISTS "generation_attempts"`,
    );
  }
}
