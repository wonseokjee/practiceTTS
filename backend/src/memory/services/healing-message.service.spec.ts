import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HealingMessage } from '../entities/healing-message.entity';
import { HealingMessageService } from './healing-message.service';

/**
 * HealingMessageService 단위 테스트 (Pattern 2).
 * - 날짜 기반 결정적 회전: 같은 날=같은 메시지, 날짜 바뀌면 다음 메시지
 * - 빈 풀 → NotFoundException(HEALING_POOL_EMPTY)
 */
describe('HealingMessageService', () => {
  let service: HealingMessageService;
  const repoMock = { find: jest.fn() };

  function msg(id: string, orderIndex: number): HealingMessage {
    return {
      id,
      text: `메시지-${id}`,
      isActive: true,
      orderIndex,
    } as HealingMessage;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        HealingMessageService,
        { provide: getRepositoryToken(HealingMessage), useValue: repoMock },
      ],
    }).compile();
    service = moduleRef.get(HealingMessageService);
  });

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  it('활성 메시지가 없으면 NotFoundException(HEALING_POOL_EMPTY)', async () => {
    repoMock.find.mockResolvedValue([]);
    await expect(service.getTodayMessage()).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('날짜 인덱스(epoch 일수 % 개수)로 메시지를 선택한다', async () => {
    repoMock.find.mockResolvedValue([msg('a', 0), msg('b', 1), msg('c', 2)]);
    // dayIndex = floor(t / MS_PER_DAY). t = 10일째 → 10 % 3 = 1 → 'b'
    const t = new Date(10 * MS_PER_DAY + 5000);

    const result = await service.getTodayMessage(t);

    expect(result.id).toBe('b');
  });

  it('같은 날에는 같은 메시지, 다음 날에는 다음 메시지를 반환한다', async () => {
    repoMock.find.mockResolvedValue([msg('a', 0), msg('b', 1), msg('c', 2)]);
    const day7morning = new Date(7 * MS_PER_DAY + 1000);
    const day7evening = new Date(7 * MS_PER_DAY + 80_000_000); // 같은 날 후반
    const day8 = new Date(8 * MS_PER_DAY + 1000);

    const a = await service.getTodayMessage(day7morning);
    const b = await service.getTodayMessage(day7evening);
    const c = await service.getTodayMessage(day8);

    expect(a.id).toBe(b.id); // 7 % 3 = 1 → 'b'
    expect(a.id).toBe('b');
    expect(c.id).toBe('c'); // 8 % 3 = 2 → 'c'
  });
});
