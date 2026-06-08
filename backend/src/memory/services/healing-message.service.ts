import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HealingMessage } from '../entities/healing-message.entity';

/** 하루 길이(ms) — 날짜 인덱스 계산용 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 매일 치유 메시지 서비스 (Pattern 2).
 *
 * 날짜 기반 결정적 회전:
 *  - 활성 메시지를 order_index ASC(안정 정렬)로 가져와
 *    (epoch 기준 경과 일수 % 개수) 인덱스의 메시지를 선택한다.
 *  - 같은 날에는 환자/보호자 모두 같은 메시지를 본다("함께 읽는" 컨셉).
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
   * @param now 테스트 주입용(기본 현재 시각)
   * @throws NotFoundException 활성 메시지가 하나도 없을 때 (HEALING_POOL_EMPTY)
   */
  async getTodayMessage(
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

    const dayIndex = Math.floor(now.getTime() / MS_PER_DAY);
    const picked = messages[dayIndex % messages.length];
    return { id: picked.id, text: picked.text };
  }
}
