import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M31: 범용 이벤트 테이블 — `events`.
 *
 * **왜 필요한가.** 기존 5개 테이블(`memory_entries`·`qab_results`·`quiz_sets`·
 * `caregiver_reflections`·`mood_entries`)은 전부 **쓰기 행동**을 timestamptz로
 * 남긴다. 없는 건 **열람**이다 — 보호자가 회복 추이 화면을 며칠에 한 번 여는지는
 * 그 어느 테이블에도 안 남는다(영어판 실행 계획 §13-4의 1). 한국 코호트 수치로
 * 뭔가 판단하려면(쓰든 안 쓰든) 열람 없이는 반쪽짜리 그림이다.
 *
 * **왜 전용 테이블 5개를 늘리는 대신 범용 테이블 하나인가(1B, 지름길 `dec-5e12e08e`).**
 * 추적할 화면·행동이 늘 때마다 테이블을 늘리면 마이그레이션이 쌓인다. 이벤트 이름을
 * 데이터로 두고 애플리케이션 레지스트리(`event-registry.ts`)로 검증하면, 새 이벤트
 * 종류를 추가하는 데 마이그레이션이 필요 없다. `gstack-shortcut(dec-5e12e08e)`:
 * 스키마 강제(체크 제약)가 아니라 애플리케이션 레지스트리로 이벤트 이름을 검증한다
 * — 늘려야 할 이벤트 종류가 지금은 3개뿐이라 스키마 제약의 이점(DB 레벨 보장)보다
 * 마이그레이션 없는 확장이 더 크다. 이벤트 종류가 늘거나 서비스가 DB를 직접 건드릴
 * 여지가 생기면 CHECK 제약으로 승격한다.
 *
 * **payload는 jsonb다.** `ValidationPipe`(main.ts:22-24)의 `whitelist`는 DTO의
 * 최상위 필드만 본다 — `payload: object` 안의 키는 안 본다(계획 §13-4의 3-1).
 * 그래서 이벤트 이름별 허용 키를 애플리케이션 레지스트리에서 따로 검증한다
 * (`event-registry.ts`). 마이그레이션 레벨에서는 막지 않는다.
 *
 * **인덱스는 `(user_id, created_at)`뿐이다.** 지금 유일한 조회 패턴이 "이 계정의
 * 최근 이벤트"이기 때문이다. `event_name`으로 거르는 조회가 생기면 그때 늘린다.
 *
 * **CASCADE.** 이 저장소의 관행(`daily_generation_usage`·`qab_results` 등)과
 * 같다 — 계정이 지워지면 그 계정의 이벤트도 함께 지운다.
 */
export class CreateEvents1786300000000 implements MigrationInterface {
  name = 'CreateEvents1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "event_name" character varying(64) NOT NULL,
        "payload" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_events_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_events_user_created"
        ON "events" ("user_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_events_user_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "events"`);
  }
}
