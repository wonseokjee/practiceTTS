import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M26: 저장된 레거시 `tile_arrange` 문항을 `speech`로 소급 전환한다 (#48 2단계).
 *
 * 생성 규칙은 이미 fill_blank → speech로 바뀌었다(QuizService#diversifyRecallQuestions,
 * #44). 문제는 **그 전에 이미 저장된** `tile_arrange` 문항이다 — 렌더러
 * (`TileArrangeInput`)는 1단계(#156)로 넘어가기가 생겼지만, 이 유형 자체를
 * 은퇴시키는 게 최종 목표다(2026-08-16 memory_quiz_design_debt.md 참고).
 *
 * 변환 규칙은 diversifyRecallQuestions가 fill_blank→speech에 쓰는 것과 동일하다:
 *   type           : tile_arrange → speech
 *   choices        : (섞인 타일 배열) → NULL
 *   prompt         : (빈칸 문장) → 고정 안내("다음 단어를 듣고 따라 말해보세요")
 *   hint_first_char: → NULL (speech는 힌트 없음)
 *   correct_answer : 그대로 (따라 읽을 단어로 그대로 쓰인다 — QuizQuestionPublic이
 *                    targetWord로 노출)
 *
 * `id`를 유지하므로 quiz_attempts.question_id 참조가 안 깨진다. 채점 규칙도
 * fill_blank/tile_arrange/speech 셋이 QuizScorerService에서 이미 같은 규칙
 * (정규화 후 정확 일치)을 쓰므로 기존 최고점과의 비교 가능성이 유지된다.
 *
 * **되돌리기가 근본적으로 불완전하다.** 원래 섞인 타일 배열(방해 음절 포함)은
 * 여기서 지워지고, 복원하려면 삭제된 buildTiles 로직(git 이력에 남아 있음)으로
 * correct_answer에서 재생성해야 한다 — 원본과 동일하지는 않다. 더 근본적으로는,
 * 이 마이그레이션이 끝나면 "원래 tile_arrange였던 speech 행"과 "정상적으로
 * 생성된 speech 행"이 구분 불가능해진다(둘 다 같은 prompt·choices=NULL 형태).
 * 그래서 down()은 시도하지 않고 명시적으로 거부한다 — 이슈에 이미 적힌 결론과
 * 같다: "down을 쓸 일이 생기면 그 자체가 신호"이므로, 되돌리는 대신 원인부터
 * 살피고 필요하면 DB 백업(PITR)으로 복구한다.
 */
export class RetireLegacyTileArrangeQuestions1785800000000 implements MigrationInterface {
  name = 'RetireLegacyTileArrangeQuestions1785800000000';

  /** diversifyRecallQuestions의 SPEECH_REPEAT_PROMPT와 반드시 같은 값이어야 한다. */
  private static readonly SPEECH_REPEAT_PROMPT =
    '다음 단어를 듣고 따라 말해보세요';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      UPDATE "quiz_questions"
      SET "type" = 'speech',
          "choices" = NULL,
          "prompt" = $1,
          "hint_first_char" = NULL
      WHERE "type" = 'tile_arrange'
      `,
      [RetireLegacyTileArrangeQuestions1785800000000.SPEECH_REPEAT_PROMPT],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // up() 이후엔 "원래 tile_arrange였던 speech 행"과 "정상 생성된 speech 행"이
    // 구분 불가능하다(둘 다 같은 형태). 되돌리면 최근에 정상 생성된 speech
    // 문항까지 (잘못) tile_arrange로 되돌리거나, 반대로 아무것도 못 건드리는
    // 수밖에 없다 — 어느 쪽도 옳지 않으므로 시도 자체를 거부한다. 몇 행이
    // 영향권인지는 알려준다 — 그래야 백업(PITR) 복구 규모를 가늠할 수 있다.
    const rows: unknown = await queryRunner.query(
      `SELECT count(*) AS "count" FROM "quiz_questions" WHERE "type" = 'speech'`,
    );
    const speechCount =
      Array.isArray(rows) && rows.length > 0
        ? String((rows[0] as { count: string }).count)
        : '?';
    throw new Error(
      '이 마이그레이션은 되돌릴 수 없습니다. up() 이후엔 "원래 tile_arrange였던 ' +
        `speech 문항"과 "정상 생성된 speech 문항"을 구분할 방법이 없습니다 ` +
        `(현재 speech 문항 ${speechCount}행, 전부 구분 불가). ` +
        '복구가 필요하면 마이그레이션 down이 아니라 DB 백업(PITR)을 쓰세요.',
    );
  }
}
