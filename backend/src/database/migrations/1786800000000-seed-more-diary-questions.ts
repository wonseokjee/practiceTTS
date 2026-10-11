import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M33: 환자 일기 질문 12개 추가 — 범주마다 3개 → 7개.
 *
 * **왜.** 환자의 하루가 단조로우면 보호자 메모가 매일 비슷하고, 같은 질문까지
 * 돌아오면 같은 메모·같은 퀴즈가 된다(#297). 질문이 범주당 3개뿐이었다. 새 질문은
 * 그날 달라진 것("어제와 달랐던 점")과 퀴즈 정답이 될 구체적 낱말(음식·장소·물건·
 * 때)을 끌어내도록 골랐다.
 *
 * M4와 같은 방식: 안정 키 (scope, text), WHERE NOT EXISTS로 멱등.
 * locale은 컬럼 기본값(ko-KR).
 * 개발 환경 시드(`memory/seeds/diary-questions.seed.ts`)와 같은 내용이어야 한다.
 *
 * down(): patient_memory_notes.question_id가 RESTRICT FK라, 이미 답이 달린 질문은
 * 지울 수 없다. 답이 없는 것만 지우고 답이 달린 것은 비활성화한다(기록 보존).
 */
const NEW_ROWS: ReadonlyArray<{
  scope: 'patient';
  category: 'activity' | 'moment' | 'context';
  text: string;
}> = [
  {
    scope: 'patient',
    category: 'activity',
    text: '오늘 아침에 환자분이 가장 먼저 한 일은 무엇인가요?',
  },
  {
    scope: 'patient',
    category: 'activity',
    text: '오늘 환자분이 손으로 한 일이 있나요? (예: 빨래 개기, 화분에 물 주기)',
  },
  {
    scope: 'patient',
    category: 'activity',
    text: '오늘 환자분이 TV나 라디오로 보거나 들은 것은 무엇인가요?',
  },
  {
    scope: 'patient',
    category: 'activity',
    text: '오늘 어제와 다르게 해 본 일이 있다면 무엇인가요?',
  },
  {
    scope: 'patient',
    category: 'moment',
    text: '오늘 어제와 달랐던 점이 있다면 하나만 적어주세요.',
  },
  {
    scope: 'patient',
    category: 'moment',
    text: '오늘 환자분이 먼저 꺼낸 이야기나 낱말이 있나요?',
  },
  {
    scope: 'patient',
    category: 'moment',
    text: '오늘 환자분이 보거나 듣고 반응을 보인 것은 무엇인가요?',
  },
  {
    scope: 'patient',
    category: 'moment',
    text: '오늘 환자분이 스스로 해낸 일이 있나요?',
  },
  {
    scope: 'patient',
    category: 'context',
    text: '오늘 점심이나 저녁에 드신 것은 무엇인가요?',
  },
  {
    scope: 'patient',
    category: 'context',
    text: '오늘 환자분이 시간을 가장 많이 보낸 곳은 어디인가요? (예: 거실, 베란다)',
  },
  {
    scope: 'patient',
    category: 'context',
    text: '오늘 날씨는 어땠고, 환자분은 무엇을 입으셨나요?',
  },
  {
    scope: 'patient',
    category: 'context',
    text: '오늘 환자분과 통화하거나 소식을 나눈 사람은 누구였나요?',
  },
];

export class SeedMoreDiaryQuestions1786800000000 implements MigrationInterface {
  name = 'SeedMoreDiaryQuestions1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const row of NEW_ROWS) {
      await queryRunner.query(
        `INSERT INTO "diary_questions" ("id", "scope", "category", "text", "is_active", "order_hint", "created_at")
         SELECT gen_random_uuid(), $1::varchar, $2::varchar, $3::varchar, TRUE, 0, now()
         WHERE NOT EXISTS (
           SELECT 1 FROM "diary_questions"
            WHERE "scope" = $1::varchar AND "text" = $3::varchar
         )`,
        [row.scope, row.category, row.text],
      );
      // down()이 답 달린 질문을 비활성화만 했다면 다시 켠다(up/down 대칭).
      await queryRunner.query(
        `UPDATE "diary_questions" SET "is_active" = TRUE
          WHERE "scope" = $1 AND "text" = $2`,
        [row.scope, row.text],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const row of NEW_ROWS) {
      await queryRunner.query(
        `DELETE FROM "diary_questions" q
          WHERE q."scope" = $1 AND q."text" = $2
            AND NOT EXISTS (
              SELECT 1 FROM "patient_memory_notes" n WHERE n."question_id" = q."id"
            )`,
        [row.scope, row.text],
      );
      await queryRunner.query(
        `UPDATE "diary_questions" SET "is_active" = FALSE
          WHERE "scope" = $1 AND "text" = $2`,
        [row.scope, row.text],
      );
    }
  }
}
