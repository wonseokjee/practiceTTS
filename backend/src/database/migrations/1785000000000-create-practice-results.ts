import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M20: 연습 모드 결과 — practice_results.
 *
 * **왜 qab_results에 컬럼을 더하지 않고 테이블을 나누는가.**
 *
 * qab_results는 검사 채널이다. 그 테이블에 들어온 행은 적응형 레벨 재계산,
 * 문항 회전 우선순위, 보호자 정확도 추세, 완료/이탈 통계 네 곳이 전부 소비한다.
 * 연습은 한 세션 40문항, 검사는 13문항 — 같은 통에 담으면 3:1로 연습이 이겨
 * 연습 성적이 곧 검사 지표가 된다. 특히 레벨 재계산은 연습 성적이 다음 검사의
 * presented_level을 정하게 만들어, 측정 도구가 자기 입력에 끌려다닌다.
 *
 * source 컬럼을 더하고 집계 네 곳에 필터를 거는 방법도 있었으나 두 가지가 걸렸다.
 * 한 곳을 빠뜨리면 조용히 오염되고(테스트로 잡기 어렵다), 아래 attempt 축을 위해
 * qab_results의 멱등 UNIQUE를 건드려야 한다 — 그 인덱스는 과거 트랜잭션 abort
 * 버그를 고치며 "멱등은 DB가 제공하게 한다"로 정착한 결과다.
 *
 * 기준은 하나다: **모양이 같으면 컬럼, 다르면 테이블.** 아래 셋이 다르다.
 *
 *  1. attempt — 검사는 한 문항 한 결과가 옳다(UNIQUE + ON CONFLICT DO NOTHING).
 *     연습은 "발화 → 막히면 단서 → 재시도"가 정상 흐름이라 한 문항에 여러 시도가
 *     남아야 한다. 단서를 주면 되는가(단서 반응성)는 실어증 예후 지표다.
 *  2. is_correct NULL 허용 — 연습은 발화를 시키되 채점하지 않는 계층(Tier 1)이
 *     있다. 연습 중엔 판정을 안 보여주므로 안 보여줄 판정에 Azure를 쓸 이유가 없다.
 *     qab_results.is_correct는 NOT NULL이라 이 상태를 표현할 수 없다.
 *  3. tier — 문항당 Azure 호출 비용 계층(0 터치 / 1 발화만 / 2 발화+채점).
 *     비용 절감이 연습 모드 재설계의 근거였으므로 실측 가능해야 한다.
 *
 * 세션 완료 마커(qab_session_completions 대응)는 만들지 않는다. 검사는 완료와
 * 이탈의 구분이 의미 있지만 연습은 중간에 끊는 것이 정상 사용이라, 마커를 두면
 * "포기율"이라는 없는 개념이 생긴다.
 */
export class CreatePracticeResults1785000000000 implements MigrationInterface {
  name = 'CreatePracticeResults1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "practice_results" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" uuid NOT NULL,
        "session_token" uuid NOT NULL,
        "item_kind" character varying(24) NOT NULL,
        "item_ref" character varying(100) NOT NULL,
        "attempt" smallint NOT NULL DEFAULT 1,
        "is_correct" boolean,
        "tier" smallint NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_practice_results" PRIMARY KEY ("id"),
        CONSTRAINT "FK_practice_results_patient"
          FOREIGN KEY ("patient_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_practice_results_tier" CHECK ("tier" BETWEEN 0 AND 2),
        CONSTRAINT "CHK_practice_results_attempt" CHECK ("attempt" >= 1)
      )
    `);

    // 멱등성: 같은 세션·같은 문항·같은 시도는 1행만. 재제출·중복 flush를 no-op으로
    // 만든다. attempt가 키에 있으므로 단서 전(1)/후(2) 시도는 서로 다른 행으로 남는다
    // — 이것이 qab_results의 dedup UNIQUE와 다른 지점이다.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_practice_results_dedup"
        ON "practice_results" ("patient_id", "session_token", "item_ref", "attempt")
    `);

    // 순응도 조회("이번 주에 며칠 했나") 전용. 연습 데이터의 주 소비처다.
    await queryRunner.query(`
      CREATE INDEX "IDX_practice_results_patient_created"
        ON "practice_results" ("patient_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "practice_results"`);
  }
}
