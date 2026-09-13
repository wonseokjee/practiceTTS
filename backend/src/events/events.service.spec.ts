import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { AppEvent } from './entities/event.entity';
import { EventsService } from './events.service';

describe('EventsService', () => {
  let service: EventsService;
  let save: jest.Mock;

  beforeEach(async () => {
    save = jest.fn().mockResolvedValue(undefined);
    // create()는 넘긴 값을 그대로 돌려주는 실제 TypeORM 동작을 흉내낸다 —
    // save()가 받는 실제 값(create의 출력)을 assertion에서 확인해야 하므로.
    const create = jest.fn((value: unknown) => value);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: getRepositoryToken(AppEvent), useValue: { create, save } },
      ],
    }).compile();
    service = module.get(EventsService);
  });

  describe('recordRequested — 사용자가 보낸 이벤트', () => {
    it('등록된 이벤트 이름 + 허용된 payload 키를 그대로 저장한다', async () => {
      await service.recordRequested('user-1', 'qab_trend_viewed', {
        screen: 'dashboard',
      });

      expect(save).toHaveBeenCalledWith({
        userId: 'user-1',
        eventName: 'qab_trend_viewed',
        payload: { screen: 'dashboard' },
      });
    });

    it('payload 없이도 저장된다', async () => {
      await service.recordRequested('user-1', 'qab_summary_viewed', undefined);

      expect(save).toHaveBeenCalledWith({
        userId: 'user-1',
        eventName: 'qab_summary_viewed',
        payload: null,
      });
    });

    it('등록되지 않은 이벤트 이름은 거부한다(400) — ValidationPipe와 같은 규칙', async () => {
      await expect(
        service.recordRequested('user-1', 'not_a_real_event', undefined),
      ).rejects.toThrow(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });

    it('등록된 이벤트라도 허용 안 된 payload 키는 거부한다(400)', async () => {
      // ValidationPipe의 whitelist는 DTO 최상위 필드만 본다 — payload 안쪽
      // 키는 이 레지스트리 검증이 유일한 방어선이다(계획 §13-4의 3-1).
      await expect(
        service.recordRequested('user-1', 'qab_trend_viewed', {
          screen: 'dashboard',
          injected: 'payload',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('recordViewed — 서버가 스스로 기록하는 열람', () => {
    it('정상 기록', async () => {
      await service.recordViewed('user-1', 'session_stats_viewed', {
        screen: 'unknown',
      });

      expect(save).toHaveBeenCalledWith({
        userId: 'user-1',
        eventName: 'session_stats_viewed',
        payload: { screen: 'unknown' },
      });
    });

    it('DB 저장이 실패해도 던지지 않는다 — 응답을 막지 않는다', async () => {
      save.mockRejectedValueOnce(new Error('connection lost'));

      await expect(
        service.recordViewed('user-1', 'qab_trend_viewed', { screen: 'x' }),
      ).resolves.toBeUndefined();
    });
  });
});
