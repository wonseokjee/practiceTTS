import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M34: `qab_results.ambiguous_retries` — 이웃 비교에서 **몇 번 다시 말하게 했나.**
 *
 * M33이 채점기 버전(`scorer_version`)과 채점 불가 이유를 남겼는데 빠진 것이 있다.
 * 이웃 비교는 목표와 가까운 다른 단어를 가르지 못하면 "한 번만 더"를 청한다. 재시도에서
 * 풀리면 **최종 결과만** 저장되므로, 1차에 모호했다는 사실이 어디에도 안 남는다. 그러면
 * 스테이징에서 볼 핵심 지표 — **환자가 "한 번 더"를 얼마나 자주 듣는가**(1차 모호율,
 * 채택 기준 15%와 직접 비교할 값) — 를 잴 방법이 없다. 재시도 후에도 못 가른 것
 * (`unscored_reason = 'ambiguous'`)만 보이고, 그건 그 지표의 일부일 뿐이다.
 *
 * 그래서 행에 재시도 횟수를 남긴다. 값의 뜻:
 *  - `NULL`: 이웃 비교를 거치지 않은 행이다(이전 채점기, 이름대기 밖, 이웃 목록에 없는 낱말).
 *  - `0`: 이웃 비교로 채점했고 다시 말하게 하지 않았다.
 *  - `1`: 1차에 모호해서 한 번 다시 말하게 했다(그 결과가 이 행이다).
 *
 * `NULL`과 `0`을 가르는 것이 요점이다. 0으로 채우면 "이웃 비교를 안 거친 행"이 "다시 말하게
 * 한 적 없는 행"과 섞여 모호율의 분모가 부풀고 비율이 조용히 낮게 나온다.
 *
 * 관측값이라 채점에 쓰지 않는다. `scorer_version`·`unscored_reason`과 같은 결정이다:
 * 널 허용, 기본값 없음, 소급 없음, CHECK 제약 없음(값 범위는 DTO가 지킨다).
 */
export class AddAmbiguousRetriesToQabResults1786600000000 implements MigrationInterface {
  name = 'AddAmbiguousRetriesToQabResults1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ADD COLUMN IF NOT EXISTS "ambiguous_retries" SMALLINT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        DROP COLUMN IF EXISTS "ambiguous_retries"
    `);
  }
}
