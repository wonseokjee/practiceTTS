import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HealingMessage } from '../entities/healing-message.entity';
import { assertTimezone, DEFAULT_TIMEZONE } from '../../common/week-boundary';

/** 하루 길이(ms) — 날짜 인덱스 계산용 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 사용자 로컬 달력 날짜를 epoch 일수로 바꾼다. UTC 경과 일수를 쓰면 서울 사용자는
 * 09:00에 메시지가 바뀌고, 미국 사용자는 저녁에 바뀐다.
 */
function localDayIndex(now: Date, timezone: string): number {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: assertTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/**
 * 매일 치유 메시지 서비스 (Pattern 2).
 *
 * 날짜 기반 결정적 회전:
 *  - 활성 메시지를 order_index ASC(안정 정렬)로 가져와
 *    (사용자 타임존 달력 날짜의 epoch 일수 % 개수) 인덱스의 메시지를 선택한다.
 *  - 같은 타임존이면 환자/보호자 모두 같은 날 같은 메시지를 본다("함께 읽는" 컨셉).
 *  - LLM 미사용(v1). 옵션 LLM 큐레이션은 후속.
 */
@Injectable()
export class HealingMessageService {
  constructor(
    @InjectRepository(HealingMessage)
    private readonly healingMessageRepository: Repository<HealingMessage>,
  ) {}

  /**
   * 오늘의 메시지 1개 반환.
   * @param timezone 사용자 IANA 타임존(users.timezone)
   * @param now 테스트 주입용(기본 현재 시각)
   * @throws NotFoundException 활성 메시지가 하나도 없을 때 (HEALING_POOL_EMPTY)
   */
  async getTodayMessage(
    timezone: string = DEFAULT_TIMEZONE,
    now: Date = new Date(),
  ): Promise<{ id: string; text: string }> {
    const messages = await this.healingMessageRepository.find({
      where: { isActive: true },
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });

    if (messages.length === 0) {
      throw new NotFoundException({
        code: 'HEALING_POOL_EMPTY',
        message: '오늘의 메시지를 찾을 수 없습니다.',
      });
    }

    const dayIndex = localDayIndex(now, timezone);
    const picked = messages[dayIndex % messages.length];
    return { id: picked.id, text: picked.text };
  }
}
