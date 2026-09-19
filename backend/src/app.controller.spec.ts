import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const query = jest.fn();

  beforeEach(async () => {
    query.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DataSource, useValue: { query } }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('DB가 SELECT 1에 응답하면 ok', async () => {
      query.mockResolvedValue([{ '?column?': 1 }]);

      await expect(appController.health()).resolves.toEqual({ status: 'ok' });
      expect(query).toHaveBeenCalledWith('SELECT 1');
    });

    it('DB 쿼리가 실패하면 503이고 원인은 응답에 싣지 않는다', async () => {
      query.mockRejectedValue(new Error('password authentication failed'));

      const err = await appController.health().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getResponse()).toEqual({
        status: 'unavailable',
      });
    });

    it('DB가 응답하지 않으면 타임아웃 뒤 503', async () => {
      jest.useFakeTimers();
      try {
        query.mockReturnValue(new Promise(() => undefined));

        const pending = appController.health().catch((e: unknown) => e);
        await jest.advanceTimersByTimeAsync(3000);

        expect(await pending).toBeInstanceOf(ServiceUnavailableException);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
