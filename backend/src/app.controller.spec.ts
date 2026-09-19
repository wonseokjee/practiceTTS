import {
  INestApplication,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

describe('AppController', () => {
  let appController: AppController;
  let testingModule: TestingModule;
  const query = jest.fn();
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    query.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    testingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DataSource, useValue: { query } }],
    }).compile();

    appController = testingModule.get<AppController>(AppController);
  });

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
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

    it('DB 쿼리가 실패하면 503이고 원인은 응답에 싣지 않되 서버 로그에는 남긴다', async () => {
      query.mockRejectedValue(new Error('password authentication failed'));

      const err = await appController.health().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getResponse()).toEqual({
        status: 'unavailable',
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'health DB check failed: Error: password authentication failed',
      );
    });

    it('DB가 응답하지 않으면 타임아웃 뒤 503이고 타임아웃을 로그에 남긴다', async () => {
      jest.useFakeTimers();
      query.mockReturnValue(new Promise(() => undefined));

      const pending = appController.health().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(3000);

      expect(await pending).toBeInstanceOf(ServiceUnavailableException);
      expect(warn).toHaveBeenCalledWith(
        'health DB check failed: Error: health DB check timed out after 3000ms',
      );
    });

    it('성공하면 타임아웃 타이머를 남기지 않는다', async () => {
      jest.useFakeTimers();
      query.mockResolvedValue([{ '?column?': 1 }]);

      await appController.health();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('동시에 온 요청은 확인 하나를 함께 기다린다', async () => {
      query.mockResolvedValue([{ '?column?': 1 }]);

      const results = await Promise.all([
        appController.health(),
        appController.health(),
        appController.health(),
      ]);

      expect(results).toEqual([
        { status: 'ok' },
        { status: 'ok' },
        { status: 'ok' },
      ]);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('끝난 결과는 3초 동안 다시 쓰고 그 뒤엔 다시 묻는다', async () => {
      jest.useFakeTimers();
      query.mockResolvedValue([{ '?column?': 1 }]);

      await appController.health();
      await jest.advanceTimersByTimeAsync(2999);
      await appController.health();
      expect(query).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      await appController.health();
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('실패도 함께 나누고 3초 안에는 다시 묻지 않는다(로그도 한 번)', async () => {
      jest.useFakeTimers();
      query.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const first = await Promise.all([
        appController.health().catch((e: unknown) => e),
        appController.health().catch((e: unknown) => e),
      ]);
      const cached = await appController.health().catch((e: unknown) => e);

      for (const err of [...first, cached]) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
      }
      expect(query).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('DB가 응답하지 않는 동안 쏟아진 요청도 쿼리는 하나만 보낸다', async () => {
      jest.useFakeTimers();
      query.mockReturnValue(new Promise(() => undefined));

      const pending = Promise.all(
        Array.from({ length: 5 }, () =>
          appController.health().catch((e: unknown) => e),
        ),
      );
      await jest.advanceTimersByTimeAsync(3000);

      for (const err of await pending) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
      }
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});

describe('GET /health (HTTP)', () => {
  let app: INestApplication<App>;
  const query = jest.fn();
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(async () => {
    query.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DataSource, useValue: { query } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    warn.mockRestore();
    error.mockRestore();
  });

  it('DB가 살아 있으면 200 {status: ok}', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);

    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('DB가 죽어 있으면 전역 필터를 거쳐도 503 {status: unavailable}이고 원인이 새지 않는다', async () => {
    query.mockRejectedValue(new Error('password authentication failed'));

    const res = await request(app.getHttpServer()).get('/health').expect(503);

    expect(res.body).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('GET /는 그대로 Hello World!', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
