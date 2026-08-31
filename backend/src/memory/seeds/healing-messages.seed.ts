import { DataSource } from 'typeorm';
import { HealingMessage } from '../entities/healing-message.entity';

/**
 * 매일 치유 메시지 시드 (Pattern 2, 24개)
 * - 환자/보호자 공용 — 회복기 가족에게 따뜻함·연결감을 주는 짧은 문장
 *
 * **"공용"은 지켜야 하는 제약이다.** 서비스가 같은 날 환자와 보호자에게 같은
 * 문장을 보여주므로(함께 읽는 컨셉), 한쪽에만 말을 거는 문장은 다른 쪽에게
 * 자기 얘기가 아닌 글이 된다. 실제로 두 문장이 그랬고 M24에서 고쳤다.
 * 새 문장을 넣을 때 "환자가 읽어도 자기 얘기인가"를 확인한다.
 * - 멱등 키: text
 * - 의학적 단정/조언 없이 정서적 지지에 한정 (임상 톤)
 *
 * 운영 전환 시 동일 의미를 마이그레이션이 보장한다.
 */
export const HEALING_MESSAGES_SEED: ReadonlyArray<string> = [
  '오늘 하루도 곁에 있어 주어 고마워요.',
  '작은 한 걸음도 회복이에요. 충분히 잘하고 있어요.',
  '함께한 오늘이 내일의 힘이 됩니다.',
  '서두르지 않아도 괜찮아요. 천천히 가요.',
  '서로의 곁에 있는 것이 가장 큰 위로예요.',
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
  '오늘 하루, 당신의 마음도 돌봐 주세요.',
  '기억은 천천히, 마음은 가까이.',
  '내일은 또 새로운 하루가 와요.',
];

export interface SeedHealingMessagesResult {
  inserted: number;
  skipped: number;
}

/**
 * 치유 메시지 시드 멱등 적용 (안정 키: text).
 * - 동일 text가 이미 있으면 skip.
 * - 개발 환경(synchronize)에서 부팅 시 호출, 운영은 마이그레이션이 동일 의미 보장.
 */
export async function seedHealingMessagesIfMissing(
  dataSource: DataSource,
): Promise<SeedHealingMessagesResult> {
  const repo = dataSource.getRepository(HealingMessage);
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < HEALING_MESSAGES_SEED.length; i += 1) {
    const text = HEALING_MESSAGES_SEED[i];
    const existing = await repo.findOne({ where: { text } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await repo.save(repo.create({ text, isActive: true, orderIndex: i }));
    inserted += 1;
  }

  return { inserted, skipped };
}
