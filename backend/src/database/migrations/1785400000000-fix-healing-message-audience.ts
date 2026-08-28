import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M24: 치유 메시지 두 문장을 공용 어투로 고친다.
 *
 * **무엇이 문제였나.** 시드 주석은 이 풀을 `환자/보호자 공용`이라고 적어놨고,
 * 서비스도 "같은 날에는 환자/보호자 모두 같은 메시지를 본다(함께 읽는 컨셉)"로
 * 설계돼 있다. 그런데 24개 중 두 문장이 **보호자에게만 말을 걸고 있었다.**
 *
 *   '당신의 돌봄이 누군가에겐 가장 큰 위로예요.'  → 환자는 돌봄을 하지 않는다
 *   '오늘 하루, 당신도 돌봄이 필요해요.'          → "당신도"가 돌보는 사람을 전제
 *
 * 회전이 날짜 기반 결정적이라, 그날이 오면 환자는 자기에게 쓴 게 아닌 글을 읽는다.
 *
 * **왜 스키마가 아니라 문구인가.** `audience` 컬럼을 넣어 역할별로 거르는 방법도
 * 있지만, 그러면 환자와 보호자가 **다른 문장**을 보게 되어 "함께 읽는" 개념이
 * 사라진다. 목표가 공용 풀인데 두 문장이 그걸 어긴 것이므로, 고칠 것은 스키마가
 * 아니라 그 두 문장이다.
 *
 * **왜 마이그레이션인가.** 시드의 멱등 키가 `text`다(`healing-messages.seed.ts`).
 * 시드 배열만 고치면 새 문구가 **새 행으로 삽입되고 옛 행은 활성인 채 남아**
 * 회전에 그대로 낀다. 기존 행을 갱신해야 한다.
 *
 * `order_index`는 건드리지 않는다 — 회전 자리는 그대로 두고 어투만 바꾼다.
 * 텍스트로 매칭하므로 두 번 돌려도 안전하다(이미 바뀐 행은 WHERE에 안 걸린다).
 *
 * **중복을 함께 지운다.** 개발 환경은 부팅 시 시드를 돌리는데 그 멱등 키가 `text`라,
 * 시드 배열이 먼저 반영된 상태에서 이 마이그레이션이 돌면 같은 문구가 두 행이 된다
 * (시드가 새 문구를 넣고, 여기서 옛 행을 같은 문구로 갱신). 회전은 활성 행을 전부
 * 세므로 그 문구만 두 배로 자주 나온다. 실제로 개발 DB에서 그렇게 됐다.
 */
const REWORDS: ReadonlyArray<{ from: string; to: string }> = [
  {
    from: '당신의 돌봄이 누군가에겐 가장 큰 위로예요.',
    to: '서로의 곁에 있는 것이 가장 큰 위로예요.',
  },
  {
    from: '오늘 하루, 당신도 돌봄이 필요해요.',
    to: '오늘 하루, 당신의 마음도 돌봐 주세요.',
  },
];

export class FixHealingMessageAudience1785400000000 implements MigrationInterface {
  name = 'FixHealingMessageAudience1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { from, to } of REWORDS) {
      await queryRunner.query(
        `UPDATE "healing_messages" SET "text" = $1 WHERE "text" = $2`,
        [to, from],
      );
    }
    // 같은 문구가 여럿이면 하나만 남긴다. 남길 기준은 (order_index, id) 최솟값 —
    // 회전 자리를 원래 슬롯에 유지하고, 어느 행이 남는지가 실행마다 달라지지
    // 않게 한다.
    await queryRunner.query(`
      DELETE FROM "healing_messages"
      WHERE "id" IN (
        SELECT "id" FROM (
          SELECT "id",
                 ROW_NUMBER() OVER (
                   PARTITION BY "text"
                   ORDER BY "order_index" ASC, "id" ASC
                 ) AS rn
          FROM "healing_messages"
        ) ranked
        WHERE ranked.rn > 1
      )
    `);
  }

  /**
   * 문구만 되돌린다. 지워진 중복은 복구하지 않는다 — 애초에 의도된 적이 없는
   * 행이고, 되살리면 그 문장만 두 배로 자주 나오는 상태로 되돌아간다.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { from, to } of REWORDS) {
      await queryRunner.query(
        `UPDATE "healing_messages" SET "text" = $1 WHERE "text" = $2`,
        [from, to],
      );
    }
  }
}
