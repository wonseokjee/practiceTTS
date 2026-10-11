import { DataSource } from 'typeorm';
import { DiaryQuestion } from '../entities/diary-question.entity';

/**
 * 보호자/환자 일기 질문 시드 (26개)
 * - 보호자 5개 (scope='caregiver', category=null)
 * - 환자 activity 7개, moment 7개, context 7개 (M4 3개씩 + M33 4개씩)
 * - 멱등 키: (scope, text)
 *
 * 임상 자문 검수는 P1-N3=(b) — Phase 1 완료 후 운영 진입 전 별도 수행.
 */
export interface DiaryQuestionSeedItem {
  scope: 'caregiver' | 'patient';
  category: 'activity' | 'moment' | 'context' | null;
  text: string;
}

export const DIARY_QUESTIONS_SEED: ReadonlyArray<DiaryQuestionSeedItem> = [
  // 보호자 회고 5개
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
  // 환자 activity 3개
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
  // 환자 moment 3개
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
  // 환자 context 3개
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
  // M33 추가 12개 — 단조로운 하루에도 그날 달라진 것·구체적 낱말을 끌어낸다(범주당 3→7)
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

/**
 * 시드 적용 결과
 */
export interface SeedDiaryQuestionsResult {
  inserted: number;
  skipped: number;
}

/**
 * 일기 질문 시드 멱등 적용
 *
 * - (scope, text) 조합을 안정 키로 사용한다.
 * - 동일 키가 이미 존재하면 skip (id/order_hint/is_active는 갱신하지 않는다).
 * - 운영 전환 시에는 마이그레이션 M4가 동일 의미를 보장한다.
 *
 * @param dataSource TypeORM DataSource
 * @returns inserted/skipped 카운트
 */
export async function seedDiaryQuestionsIfMissing(
  dataSource: DataSource,
): Promise<SeedDiaryQuestionsResult> {
  const repo = dataSource.getRepository(DiaryQuestion);
  let inserted = 0;
  let skipped = 0;

  for (const item of DIARY_QUESTIONS_SEED) {
    const existing = await repo.findOne({
      where: { scope: item.scope, text: item.text },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    const entity = repo.create({
      scope: item.scope,
      category: item.category,
      text: item.text,
      isActive: true,
      orderHint: 0,
    });
    await repo.save(entity);
    inserted += 1;
  }

  return { inserted, skipped };
}
