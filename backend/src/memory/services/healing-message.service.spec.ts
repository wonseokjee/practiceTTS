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
    await expect(service.getTodayMessage('Asia/Seoul')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('날짜 인덱스(epoch 일수 % 개수)로 메시지를 선택한다', async () => {
    repoMock.find.mockResolvedValue([msg('a', 0), msg('b', 1), msg('c', 2)]);
    // dayIndex = floor(t / MS_PER_DAY). t = 10일째 → 10 % 3 = 1 → 'b'
    const t = new Date(10 * MS_PER_DAY + 5000);

    const result = await service.getTodayMessage('UTC', t);

    expect(result.id).toBe('b');
  });

  it('같은 날에는 같은 메시지, 다음 날에는 다음 메시지를 반환한다', async () => {
    repoMock.find.mockResolvedValue([msg('a', 0), msg('b', 1), msg('c', 2)]);
    const day7morning = new Date(7 * MS_PER_DAY + 1000);
    const day7evening = new Date(7 * MS_PER_DAY + 80_000_000); // 같은 날 후반
    const day8 = new Date(8 * MS_PER_DAY + 1000);

    const a = await service.getTodayMessage('UTC', day7morning);
    const b = await service.getTodayMessage('UTC', day7evening);
    const c = await service.getTodayMessage('UTC', day8);

    expect(a.id).toBe(b.id); // 7 % 3 = 1 → 'b'
    expect(a.id).toBe('b');
    expect(c.id).toBe('c'); // 8 % 3 = 2 → 'c'
  });

  it('타임존 자정 기준으로 바뀐다 — 서울 자정 직후(UTC 15시)에 다음 메시지', async () => {
    repoMock.find.mockResolvedValue([msg('a', 0), msg('b', 1), msg('c', 2)]);
    // 서울 2026-01-01 23:59 = UTC 14:59 / 서울 2026-01-02 00:01 = UTC 15:01
    const before = new Date('2026-01-01T14:59:00Z');
    const after = new Date('2026-01-01T15:01:00Z');

    const a = await service.getTodayMessage('Asia/Seoul', before);
    const b = await service.getTodayMessage('Asia/Seoul', after);
    // 같은 두 시각이 UTC 기준으론 같은 날이다 — 서울 기준으론 다른 날
    const utcA = await service.getTodayMessage('UTC', before);
    const utcB = await service.getTodayMessage('UTC', after);

    expect(a.id).not.toBe(b.id);
    expect(utcA.id).toBe(utcB.id);
  });

  it('같은 순간에 타임존이 다르면 각자의 달력 날짜를 따른다', async () => {
    repoMock.find.mockResolvedValue([msg('a', 0), msg('b', 1), msg('c', 2)]);
    const t = new Date('2026-01-01T20:00:00Z'); // 서울 1/2 05시, LA 1/1 12시

    const seoul = await service.getTodayMessage('Asia/Seoul', t);
    const la = await service.getTodayMessage('America/Los_Angeles', t);

    expect(seoul.id).not.toBe(la.id);
  });

  it('허용되지 않는 타임존 문자열은 거부한다', async () => {
    repoMock.find.mockResolvedValue([msg('a', 0)]);
    await expect(service.getTodayMessage("x'; drop")).rejects.toThrow();
  });
});
