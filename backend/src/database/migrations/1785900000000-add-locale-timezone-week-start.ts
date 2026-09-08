import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M27: 로케일·타임존·주 시작 요일 — 사용자 한 명이 어느 언어와 어느 시간 축에
 * 사는가.
 *
 * 영어판 실행 계획(`docs/history/20260906_EnglishLocalization_execution_plan.md`)
 * §3의 0-1·0-5. 셋을 **한 마이그레이션**에 묶는 이유는 셋 다 "사용자 한 명이
 * 어느 축에 사는가"를 말하고, 나중에 쪼개 넣으면 그 사이에 쌓인 행의 뜻이
 * 갈리기 때문이다.
 *
 * **왜 지금인가.** 사용자가 0명일 때만 싸다. 지금 기존 행은 전부 한국어·KST라
 * 소급 채우기가 자명하다 — 영어 사용자가 한 명이라도 들어온 뒤에는 어느 행이
 * 어느 언어였는지 되짚을 방법이 없어진다. `manifest_version`(M23)을 넣은 것과
 * **정확히 같은 이유**다.
 *
 * ## 왜 `users`인가 (계획서는 "프로필 엔티티"라고 적었다)
 *
 * `users`는 자기참조 구조다 — 보호자 행이 `patient_id`로 환자 행을 가리키고,
 * 보호자와 환자가 **각각 독립된 행**이다. 그래서 계획서의
 * `patient_locale`/`caregiver_locale` 두 값은 여기서 **`locale` 한 컬럼이
 * 두 행에 담기는 모양**이 된다.
 *
 * `patient_profiles`에 두지 않은 이유가 둘이다.
 *
 * 1. **프로필 행은 선택이다.** 보호자가 배경정보를 넣어야 생기고, 코드가
 *    "프로필 미등록"을 정상 상태로 다룬다(`persona-context.service.ts:35`).
 *    타임존은 **집계 축**이라 모든 환자에게 반드시 있어야 하는데, 프로필에
 *    두면 프로필 없는 환자는 값이 없어 서버 TZ로 폴백한다 — 이 마이그레이션이
 *    잡으려는 바로 그 버그가 남는다. 환자 `users` 행은 가입 시 **항상**
 *    생긴다(`auth.service.ts:530`).
 * 2. 보호자가 환자를 둘 돌보면 `caregiver_locale`이 프로필 두 행에 중복돼
 *    엇갈릴 수 있다. 보호자의 언어는 보호자의 속성이지 환자별 속성이 아니다.
 *
 * ## 타임존·주 시작 요일은 나누지 않는다
 *
 * 로케일과 달리 이 둘은 언어가 아니라 **집계 축**이다. 환자·보호자로 나누면
 * 같은 데이터가 두 가지로 집계된다. 환자 행의 값 하나만 쓴다.
 *
 * 그리고 **로케일에서 파생시키지 않는다.** `en-US`라도 사용자가 월요일 시작을
 * 원할 수 있고, 미국만 타임존이 넷 이상이라 이민자·여행 중 사용자가 틀린다.
 * 무엇보다 **집계가 서버에서 일어나므로 서버가 그 값을 알아야 한다.**
 *
 * ## `qab_results.locale`은 NULL을 허용한다
 *
 * `manifest_version`(M23)과 같은 모양이다. NULL이 정상이다 — 컬럼 이전의 모든
 * 행, 그리고 값을 안 보내는 옛 클라이언트. 기본값을 채워 "모름"을 특정 로케일로
 * 바꾸면 없는 사실이 생긴다.
 *
 * 이 컬럼에는 **세션 시작 시점에 고정된 환자 로케일**이 들어간다(계획 §7-7 B).
 * 문항을 푼 것은 환자이므로 보호자 로케일은 이 행에 뜻이 없다.
 *
 * **이 마이그레이션은 동작을 바꾸지 않는다.** 컬럼만 만들고, 읽는 코드는
 * 후속(주 경계 헬퍼·제출 DTO)에서 붙인다. 기본값이 현재 동작과 같아서
 * (`ko-KR`·`Asia/Seoul`·월요일) 지금 배포해도 화면은 1px도 안 바뀐다.
 */
export class AddLocaleTimezoneWeekStart1785900000000 implements MigrationInterface {
  name = 'AddLocaleTimezoneWeekStart1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // BCP 47 태그(`ko-KR`, `en-US`). 8자면 `zh-Hant-TW`(10자)를 못 담지만
    // 계획이 `en-US` 단일 목표라 지금 넓힐 근거가 없다 — 필요해지면 그때 늘린다.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "locale" VARCHAR(8) NOT NULL DEFAULT 'ko-KR'
    `);

    // IANA 타임존 이름(`Asia/Seoul`, `America/Los_Angeles`). 오프셋(+09:00)이
    // 아니라 이름을 담는 이유는 서머타임 때문이다 — 미국은 오프셋이 해마다 두 번
    // 바뀌고, 오프셋을 얼리면 그 경계에서 하루가 어긋난다.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64) NOT NULL
        DEFAULT 'Asia/Seoul'
    `);

    // 0=일요일 … 6=토요일. JS `Date#getDay()`·Postgres `EXTRACT(DOW)`와 같은
    // 축이라 프론트·백엔드가 같은 숫자를 읽는다. ISO(`EXTRACT(ISODOW)`,
    // 1=월요일)와 헷갈리기 쉬워 컬럼 주석으로 못 박아 둔다.
    //
    // 기본 1(월요일)은 **현재 동작 그대로**다 — Postgres `date_trunc('week')`가
    // ISO 월요일 고정이고 프론트 `streak.ts`의 `mondayOf()`도 월요일이다.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "week_start" SMALLINT NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "CHK_users_week_start"
        CHECK ("week_start" BETWEEN 0 AND 6)
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "users"."week_start" IS
        '주 시작 요일. 0=일요일 … 6=토요일 (JS getDay·PG EXTRACT(DOW)와 같은 축)'
    `);

    // 세션 시작 시점에 고정한 환자 로케일. NULL=모름(컬럼 이전 행·옛 클라이언트).
    await queryRunner.query(`
      ALTER TABLE "qab_results"
        ADD COLUMN IF NOT EXISTS "locale" VARCHAR(8)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "qab_results" DROP COLUMN IF EXISTS "locale"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "CHK_users_week_start"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "week_start"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "timezone"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "locale"
    `);
  }
}
