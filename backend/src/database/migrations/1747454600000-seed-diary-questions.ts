import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M4: diary_questions 14개 row 멱등 시드.
 *
 * - 안정 키: (scope, text)
 * - up(): WHERE NOT EXISTS 가드로 중복 적용 안전
 * - down(): P1-N2=(a) — 14개 시드 텍스트만 정확 매칭하여 삭제 (TRUNCATE 금지)
 *
 * 시드 내용은 코드 측 `backend/src/memory/seeds/diary-questions.seed.ts` 와 동일해야 한다.
 * (운영 환경 = 마이그레이션 / 개발 환경 = 시드 함수 — 동일 의미 보장)
 */
interface SeedRow {
  scope: 'caregiver' | 'patient';
  category: 'activity' | 'moment' | 'context' | null;
  text: string;
}

const SEED_ROWS: ReadonlyArray<SeedRow> = [
  {
    scope: 'caregiver',
    category: null,
    text: '오늘 나에게 가장 힘들었던 순간은 무엇이었나요?',
  },
  {
    scope: 'caregiver',
    category: null,
    text: '오늘 나를 잠깐이라도 웃게 한 일은 무엇이었나요?',
  },
  {
    scope: 'caregiver',
    category: null,
    text: '오늘 환자분을 돌보며 가장 보람을 느낀 순간은?',
  },
  {
    scope: 'caregiver',
    category: null,
    text: '지금 나에게 가장 필요한 것은 무엇인가요?',
  },
  {
    scope: 'caregiver',
    category: null,
    text: '오늘 잠들기 전 스스로에게 해주고 싶은 말은?',
  },
  {
    scope: 'patient',
    category: 'activity',
    text: '오늘 환자분과 함께 한 활동은 무엇이었나요?',
  },
  {
    scope: 'patient',
    category: 'activity',
    text: '오늘 환자분이 가장 좋아한 활동은 무엇이었나요?',
  },
  {
    scope: 'patient',
    category: 'activity',
    text: '오늘 환자분이 새로 시도한 활동이 있나요?',
  },
  {
    scope: 'patient',
    category: 'moment',
    text: '오늘 환자분에게 가장 기억에 남을 순간은?',
  },
  {
    scope: 'patient',
    category: 'moment',
    text: '오늘 환자분이 웃었던 순간을 적어주세요.',
  },
  {
    scope: 'patient',
    category: 'moment',
    text: '오늘 환자분과 나눈 가장 따뜻한 한마디는?',
  },
  {
    scope: 'patient',
    category: 'context',
    text: '오늘 환자분이 만난 사람은 누구였나요?',
  },
  {
    scope: 'patient',
    category: 'context',
    text: '오늘 환자분이 다녀온 곳은 어디였나요?',
  },
  {
    scope: 'patient',
    category: 'context',
    text: '오늘 환자분이 드신 음식 중 기억에 남는 것은?',
  },
];

export class SeedDiaryQuestions1747454600000 implements MigrationInterface {
  name = 'SeedDiaryQuestions1747454600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const row of SEED_ROWS) {
      await queryRunner.query(
        `INSERT INTO "diary_questions" ("id", "scope", "category", "text", "is_active", "order_hint", "created_at")
         SELECT gen_random_uuid(), $1, $2, $3, TRUE, 0, now()
         WHERE NOT EXISTS (
           SELECT 1 FROM "diary_questions" WHERE "scope" = $1 AND "text" = $3
         )`,
        [row.scope, row.category, row.text],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // P1-N2=(a): 14개 텍스트 정확 매칭 삭제 (사용자 추가 row는 보존)
    for (const row of SEED_ROWS) {
      await queryRunner.query(
        `DELETE FROM "diary_questions" WHERE "scope" = $1 AND "text" = $2`,
        [row.scope, row.text],
      );
    }
  }
}
