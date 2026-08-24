import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M22: QAB 결과에 '채점 불가(unscored)' 추가 — 못 잰 것을 못했다고 기록하지 않는다.
 *
 * 지금까지 음향 발음 평가가 실패하면 앱은 조용히 문자열 근접도 채점으로
 * 폴백했다. 그건 **다른 것을 재는 다른 자**다. 같은 환자의 같은 과제 점수가
 * 그날 네트워크 상태에 따라 달라지면 회차 간 비교가 성립하지 않는다.
 *
 * 실측이 그 우려를 확인했다(2026-08-22, 608 test 417세그): Azure accuracy와
 * 문자열 채점 오류율의 순위상관은 −0.376으로, 사전 등록한 기준(0.6)의 절반이다.
 * 두 경로는 같은 것을 재지 않는다.
 *
 * 그래서 채점 불가를 1급 상태로 만든다. 이 행은
 *  - 정확도 집계의 **분모에서 빠지고**(오답이 아니다)
 *  - 발음 점수 평균에서 빠지며(score가 null이다)
 *  - 적응형 레벨링 윈도우에서 빠진다(레벨 자연 홀드 — 비처벌)
 *  - 그러면서 **행 자체는 남는다.** 채점 실패율을 볼 수 없으면 조용히 망가진다.
 *
 * 구데이터는 전부 false다 — 그 시절엔 채점 불가가 존재하지 않았다.
 */
export class AddUnscoredToQabResults1785200000000 implements MigrationInterface {
  name = 'AddUnscoredToQabResults1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ADD COLUMN IF NOT EXISTS "unscored" BOOLEAN NOT NULL DEFAULT FALSE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        DROP COLUMN IF EXISTS "unscored"
    `);
  }
}
