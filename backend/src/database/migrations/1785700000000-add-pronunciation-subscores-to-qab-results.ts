import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M24: QAB 결과에 발음 세부 점수(accuracy·completeness·fluency)를 남긴다.
 *
 * 문장 종합점수는 `accuracy*0.6 + completeness*0.4`(good 이상=합격)다. 그런데
 * 가중 평균이라 한 축이 다른 축을 완전히 보상한다 — accuracy 95·completeness 30
 * (열 어절 중 세 어절만 또렷하게 말함)이어도 69점으로 합격한다. 누락은 비유창성
 * 실어증의 핵심 증상인데, 조음이 깨끗하면 그 증상을 사실상 안 보는 셈이다.
 *
 * 가중치를 바꾸기 전에 먼저 재야 한다. 지금까지 `accuracyScore`·
 * `completenessScore`·`fluencyScore`는 종합점수를 만드는 데만 쓰이고 계산
 * 직후 버려졌다 — `QabResult`에 `score` 하나만 남고 백엔드에도 안 갔다. 그래서
 * "이 상호보상이 실제로 얼마나 자주 일어나는지" 아무도 몰랐다.
 *
 * 이 마이그레이션은 **저장만** 늘린다. 채점 로직(가중치·합격선)은 그대로다 —
 * 결정: 재는 것부터, 정하는 것은 나중(TODOS "다음 할 일" 2번, 2026-09-03).
 *
 * unscored 행은 세 값 다 NULL이다(quiz.service.ts가 지운다) — score와 같은
 * 규약이다. 구데이터도 NULL이다 — 그 시절엔 이 값을 안 실었다.
 */
export class AddPronunciationSubscoresToQabResults1785700000000 implements MigrationInterface {
  name = 'AddPronunciationSubscoresToQabResults1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ADD COLUMN IF NOT EXISTS "accuracy_score" SMALLINT,
        ADD COLUMN IF NOT EXISTS "completeness_score" SMALLINT,
        ADD COLUMN IF NOT EXISTS "fluency_score" SMALLINT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        DROP COLUMN IF EXISTS "accuracy_score",
        DROP COLUMN IF EXISTS "completeness_score",
        DROP COLUMN IF EXISTS "fluency_score"
    `);
  }
}
