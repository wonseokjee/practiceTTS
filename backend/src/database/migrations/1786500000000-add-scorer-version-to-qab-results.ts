import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M33: `qab_results.scorer_version` · `qab_results.unscored_reason`.
 *
 * 이웃 비교 채점(docs/history/20260926_NeighborScoring_*)의 기록 쪽이다. 이 마이그레이션은
 * 컬럼을 만들 뿐이고, 값을 채우는 것은 기능 플래그가 켜진 클라이언트다 — 그래서 동작을
 * 바꾸지 않는다.
 *
 * ## `scorer_version` — 점수는 채점기 버전에 묶인다
 *
 * 이웃 비교는 정답 처리 규칙을 바꾼다. 가까운 다른 단어를 말했을 때 예전에는 정답으로
 * 쳤고(근접 오통과 35.7%), 이제는 모호로 옮긴다. 그러면 전환 시점에 정답률이 내려가는데
 * 그건 환자가 나빠진 게 아니라 **자가 바뀐 것**이다. 버전을 행에 남겨야 진전 그래프가
 * 전환을 넘어 기울기를 잇지 않는다(음향 채점 계획 7절).
 *
 * **NULL이 정상이다** — 이 컬럼 이전의 행이다. `manifest_version`·`locale`과 같은 관례다:
 * NULL은 "모름"이 아니라 그 시절의 유일한 채점기였던 `azure-pa-v1`을 뜻한다. 소급해서
 * 채우지 않는다. 채우면 "이 행이 v1로 기록됐다"는 거짓 사실이 생기고, 읽는 쪽이
 * `COALESCE(scorer_version, 'azure-pa-v1')`로 같은 뜻을 얻는다.
 *
 * ## `unscored_reason` — 못 잰 이유
 *
 * `unscored`는 "못 쟀다"만 말한다. 이웃 비교부터는 못 재는 이유가 둘로 갈린다:
 *  - `no_score`: 채점 서버에 못 닿았거나 인식 결과가 없다(기존의 유일한 이유)
 *  - `ambiguous`: 재시도까지 했는데 목표와 가까운 다른 단어를 가르지 못했다
 * 둘을 갈라 세야 문턱(모호율)을 조정할 근거가 생긴다. `no_score`가 늘면 채점 경로를,
 * `ambiguous`가 늘면 판정 규칙을 의심해야 한다.
 *
 * `unscored = false`인 행은 NULL이다(서버가 지운다). 옛 행과 이유를 안 보낸
 * 클라이언트의 unscored 행도 NULL이다.
 *
 * 길이는 값 목록(`QAB_SCORER_VERSIONS`·`QAB_UNSCORED_REASONS`)에 여유를 둔 값이다.
 * CHECK 제약은 두지 않는다 — 값 목록은 DTO가 지키고, 새 버전이 늘 때마다 제약을
 * 바꾸는 마이그레이션이 필요해지는 것을 피한다(`foil_kind`와 같은 결정).
 */
export class AddScorerVersionToQabResults1786500000000 implements MigrationInterface {
  name = 'AddScorerVersionToQabResults1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ADD COLUMN IF NOT EXISTS "scorer_version" VARCHAR(24),
        ADD COLUMN IF NOT EXISTS "unscored_reason" VARCHAR(16)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        DROP COLUMN IF EXISTS "unscored_reason",
        DROP COLUMN IF EXISTS "scorer_version"
    `);
  }
}
