import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M12: 스키마 드리프트 정리 — healing_messages 타임스탬프 타입 + 누락 인덱스.
 *
 * 나머지 테이블은 처음부터 TIMESTAMPTZ였는데 healing_messages만 TIMESTAMP로
 * 만들어져 있었다. 엔티티 쪽도 타입을 지정하지 않아 TypeORM 기본값(TIMESTAMP)이
 * 잡혔고, 그래서 `schema:log`가 타임스탬프 컬럼 16개를 상시 "DROP 후 재생성"
 * 대상으로 잡았다.
 *
 * 이게 위험한 이유: 누군가 운영에서 synchronize를 켜면 그 16개 컬럼이 실제로
 * DROP되고 다시 만들어진다 — 생성 시각 기록이 통째로 날아간다.
 *
 * 엔티티를 timestamptz로 명시하고(코드 변경), 유일하게 어긋나 있던
 * healing_messages를 여기서 맞춘다.
 *
 * 변환 시 타임존 해석에 주의해야 한다. 저장된 naive 값은 `now()`가 **세션
 * 타임존의 벽시계**로 기록한 것이라, 이를 'UTC'로 해석하면 서버 오프셋만큼
 * (KST면 9시간) 전체가 밀린다. current_setting('TimeZone')으로 해석해야
 * 원래 순간이 보존된다.
 *
 * 함께: 엔티티에만 있고 마이그레이션에 없던 인덱스를 추가한다.
 */
export class AlignTimestamptzAndIndexes1784300000000
  implements MigrationInterface
{
  name = 'AlignTimestamptzAndIndexes1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "healing_messages"
        ALTER COLUMN "created_at" TYPE TIMESTAMPTZ
        USING "created_at" AT TIME ZONE current_setting('TimeZone')
    `);

    // 퀴즈 목록 조회(환자 + 생성상태 + 최신순)를 받치는 인덱스.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_quiz_sets_patient_status_created"
        ON "quiz_sets" ("patient_id", "generation_status", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_quiz_sets_patient_status_created"`,
    );
    await queryRunner.query(`
      ALTER TABLE "healing_messages"
        ALTER COLUMN "created_at" TYPE TIMESTAMP
        USING "created_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }
}
