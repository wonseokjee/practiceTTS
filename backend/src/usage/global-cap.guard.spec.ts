import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AiProxyController } from '../ai-proxy/ai-proxy.controller';
import { MemoryController } from '../memory/memory.controller';
import { QuizController } from '../quiz/quiz.controller';
import { TrainingController } from '../training/training.controller';
import { DailyCapGuard, DAILY_GENERATION_LIMIT } from './daily-cap.guard';
import { GLOBAL_CAP_KINDS, GLOBAL_DAILY_CAPS } from './daily-global-caps';
import { GLOBAL_CAP_KEY, GlobalCapGuard } from './global-cap.guard';
import {
  GlobalUsageService,
  secondsUntilNextUtcMidnight,
} from './global-usage.service';

function contextFor(
  handler: () => unknown,
  setHeader = jest.fn(),
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
}

/** 메서드에 `@GlobalCap(kind)`가 붙은 것처럼 메타데이터만 단다. */
function handlerWith(kind?: string): () => unknown {
  const handler = () => undefined;
  if (kind) Reflect.defineMetadata(GLOBAL_CAP_KEY, kind, handler);
  return handler;
}

describe('GlobalCapGuard', () => {
  let consume: jest.Mock;
  let guard: GlobalCapGuard;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    consume = jest.fn();
    guard = new GlobalCapGuard(new Reflector(), {
      consume,
    } as unknown as GlobalUsageService);
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it('@GlobalCap이 없는 라우트는 세지도 막지도 않는다', async () => {
    await expect(guard.canActivate(contextFor(handlerWith()))).resolves.toBe(
      true,
    );
    expect(consume).not.toHaveBeenCalled();
  });

  it('상한 안이면 통과한다', async () => {
    consume.mockResolvedValue({
      allowed: true,
      count: 10,
      limit: 3000,
      retryAfterSeconds: 100,
    });

    await expect(
      guard.canActivate(contextFor(handlerWith('stt'))),
    ).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith('stt');
    expect(logError).not.toHaveBeenCalled();
  });

  it('상한을 넘으면 429 + Retry-After + 가구 상한과 같은 안내 코드 + scope=global', async () => {
    consume.mockResolvedValue({
      allowed: false,
      count: 3001,
      limit: 3000,
      retryAfterSeconds: 7200,
    });
    const setHeader = jest.fn();

    const error = await guard
      .canActivate(contextFor(handlerWith('stt'), setHeader))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    expect(http.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(http.getResponse()).toMatchObject({
      code: DAILY_GENERATION_LIMIT,
      scope: 'global',
      kind: 'stt',
      limit: 3000,
      retryAfter: 7200,
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '7200');
  });

  it('상한을 처음 넘는 순간에만 에러 로그를 남긴다(이후 요청마다 반복하지 않는다)', async () => {
    const over = (count: number) => ({
      allowed: false,
      count,
      limit: 3000,
      retryAfterSeconds: 60,
    });

    consume.mockResolvedValueOnce(over(3001));
    await guard.canActivate(contextFor(handlerWith('stt'))).catch(() => null);
    consume.mockResolvedValueOnce(over(3002));
    await guard.canActivate(contextFor(handlerWith('stt'))).catch(() => null);

    expect(logError).toHaveBeenCalledTimes(1);
    expect((logError.mock.calls[0] as [string])[0]).toContain('stt');
  });
});

describe('secondsUntilNextUtcMidnight', () => {
  it('UTC 자정까지 남은 초', () => {
    expect(secondsUntilNextUtcMidnight(new Date('2026-10-27T23:00:00Z'))).toBe(
      3600,
    );
    expect(secondsUntilNextUtcMidnight(new Date('2026-10-27T00:00:00Z'))).toBe(
      86400,
    );
  });

  it('자정 직전 1초 남았으면 1, 절대 0이나 음수가 아니다', () => {
    expect(secondsUntilNextUtcMidnight(new Date('2026-10-27T23:59:59Z'))).toBe(
      1,
    );
    expect(
      secondsUntilNextUtcMidnight(new Date('2026-10-27T23:59:59.999Z')),
    ).toBe(1);
  });

  it('월말·연말 경계도 넘어간다', () => {
    expect(secondsUntilNextUtcMidnight(new Date('2026-12-31T12:00:00Z'))).toBe(
      43200,
    );
  });
});

describe('상한 표', () => {
  it('종류마다 양의 정수 상한이 있다', () => {
    for (const kind of GLOBAL_CAP_KINDS) {
      expect(Number.isInteger(GLOBAL_DAILY_CAPS[kind])).toBe(true);
      expect(GLOBAL_DAILY_CAPS[kind]).toBeGreaterThan(0);
    }
  });

  it('종류 이름이 컬럼(varchar 16)에 들어간다', () => {
    for (const kind of GLOBAL_CAP_KINDS) {
      expect(kind.length).toBeLessThanOrEqual(16);
    }
  });
});

/**
 * 비용이 나는 일곱 경로 전부에 전체 상한이 붙어 있다 — 하나라도 빠지면 그 경로로 청구서가 샌다.
 * 생성 네 경로는 가구별 상한 **뒤에** 붙어야 한다(가구 하나의 폭주가 전체 몫을 갉아먹지 않게).
 */
describe('경로 배선', () => {
  const controllers = {
    MemoryController,
    QuizController,
    TrainingController,
    AiProxyController,
  };
  type Name = keyof typeof controllers;

  const handler = (controller: Name, method: string): object =>
    (controllers[controller].prototype as unknown as Record<string, object>)[
      method
    ];
  const capOf = (controller: Name, method: string) =>
    Reflect.getMetadata(GLOBAL_CAP_KEY, handler(controller, method)) as
      | string
      | undefined;
  const guardsOf = (controller: Name, method: string) =>
    (Reflect.getMetadata(GUARDS_METADATA, handler(controller, method)) ??
      []) as unknown[];

  it.each([
    ['MemoryController', 'create', 'memory'],
    ['MemoryController', 'triggerScenario', 'scenario'],
    ['QuizController', 'generate', 'quiz'],
    ['TrainingController', 'sendMessage', 'conversation'],
    ['AiProxyController', 'stt', 'stt'],
    ['AiProxyController', 'pronunciation', 'pronunciation'],
    ['AiProxyController', 'tts', 'tts'],
  ] as const)('%s.%s → %s', (controller, method, kind) => {
    expect(capOf(controller, method)).toBe(kind);
    expect(guardsOf(controller, method)).toContain(GlobalCapGuard);
  });

  it.each([
    ['MemoryController', 'create'],
    ['MemoryController', 'triggerScenario'],
    ['QuizController', 'generate'],
    ['TrainingController', 'sendMessage'],
  ] as const)(
    '%s.%s: 가구별 상한이 전체 상한보다 먼저 돈다',
    (controller, method) => {
      const guards = guardsOf(controller, method);
      expect(guards.indexOf(DailyCapGuard)).toBeGreaterThanOrEqual(0);
      expect(guards.indexOf(DailyCapGuard)).toBeLessThan(
        guards.indexOf(GlobalCapGuard),
      );
    },
  );

  it('AI를 부르지 않는 옆 경로에는 전체 상한이 없다', () => {
    expect(capOf('TrainingController', 'createSession')).toBeUndefined();
    expect(capOf('MemoryController', 'update')).toBeUndefined();
  });
});
