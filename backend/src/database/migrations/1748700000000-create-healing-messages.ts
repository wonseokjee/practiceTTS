import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 Pattern 2: healing_messages 테이블 생성 + 24개 멱등 시드.
 *
 * - 안정 키: text
 * - up(): CREATE TABLE IF NOT EXISTS + WHERE NOT EXISTS 가드 INSERT
 * - down(): DROP TABLE
 *
 * 시드 내용은 `backend/src/memory/seeds/healing-messages.seed.ts`와 동일해야 한다.
 */
const SEED_TEXTS: ReadonlyArray<string> = [
  '오늘 하루도 곁에 있어 주어 고마워요.',
  '작은 한 걸음도 회복이에요. 충분히 잘하고 있어요.',
  '함께한 오늘이 내일의 힘이 됩니다.',
  '서두르지 않아도 괜찮아요. 천천히 가요.',
  '당신의 돌봄이 누군가에겐 가장 큰 위로예요.',
  '오늘 웃은 순간 하나면 충분해요.',
  '잘 안 되는 날도 있어요. 그래도 괜찮아요.',
  '어제보다 조금 나아졌다면 그것으로 충분해요.',
  '말 한마디보다 함께 있는 시간이 더 큰 말이에요.',
  '당신은 혼자가 아니에요.',
  '오늘의 작은 기쁨을 기억해요.',
  '쉬어가는 것도 회복의 일부예요.',
  '서로의 하루를 들어주는 것만으로 충분해요.',
  '느린 회복도 분명한 회복이에요.',
  '오늘 못한 일은 내일 다시 하면 돼요.',
  '당신의 노력은 보이지 않아도 쌓이고 있어요.',
  '함께 보낸 평범한 하루가 가장 소중해요.',
  '마음이 지칠 땐 잠시 멈춰도 돼요.',
  '오늘도 서로에게 좋은 하루였길 바라요.',
  '작은 변화에도 박수를 보내요.',
  '곁을 지키는 것만으로 큰 사랑이에요.',
  '오늘 하루, 당신도 돌봄이 필요해요.',
  '기억은 천천히, 마음은 가까이.',
  '내일은 또 새로운 하루가 와요.',
];

export class CreateHealingMessages1748700000000 implements MigrationInterface {
  name = 'CreateHealingMessages1748700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "healing_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "text" character varying(300) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "order_index" smallint NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_healing_messages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_healing_messages_active" ON "healing_messages" ("is_active")`,
    );

    for (let i = 0; i < SEED_TEXTS.length; i += 1) {
      await queryRunner.query(
        `INSERT INTO "healing_messages" ("id", "text", "is_active", "order_index", "created_at")
         SELECT gen_random_uuid(), $1, TRUE, $2, now()
         WHERE NOT EXISTS (
           SELECT 1 FROM "healing_messages" WHERE "text" = $1
         )`,
        [SEED_TEXTS[i], i],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "healing_messages"`);
  }
}
