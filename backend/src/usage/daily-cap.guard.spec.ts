import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { User } from '../auth/entities/user.entity';
import { MemoryController } from '../memory/memory.controller';
import { QuizController } from '../quiz/quiz.controller';
import { TrainingController } from '../training/training.controller';
import {
  DAILY_CAP_KEY,
  DAILY_GENERATION_LIMIT,
  DailyCapGuard,
} from './daily-cap.guard';
import type { GenerationUsageService } from './generation-usage.service';

// MemoryController가 끌고 오는 uuid는 ESM 빌드라 ts-jest(CJS)가 못 읽는다.
// 여기선 데코레이터 메타데이터만 보므로 대역으로 충분하다.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));

const CAREGIVER = {
  id: 'caregiver-1',
  role: 'caregiver',
  patientId: 'patient-1',
} as User;

function contextFor(
  handler: () => unknown,
  user: User,
  setHeader = jest.fn(),
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
}

/** 메서드에 `@DailyCap(kind)`가 붙은 것처럼 메타데이터만 단다. */
function handlerWith(kind?: string): () => unknown {
  const handler = () => undefined;
  if (kind) Reflect.defineMetadata(DAILY_CAP_KEY, kind, handler);
  return handler;
}

describe('DailyCapGuard', () => {
  let consume: jest.Mock;
  let guard: DailyCapGuard;

  beforeEach(() => {
    consume = jest.fn();
    guard = new DailyCapGuard(new Reflector(), {
      consume,
    } as unknown as GenerationUsageService);
  });

  it('@DailyCap이 없는 라우트는 세지도 막지도 않는다', async () => {
    await expect(
      guard.canActivate(contextFor(handlerWith(), CAREGIVER)),
    ).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });

  it('상한 안이면 통과하고, 보호자는 연결된 환자 몫으로 센다', async () => {
    consume.mockResolvedValue({
      allowed: true,
      count: 3,
      limit: 30,
      retryAfterSeconds: 100,
    });

    await expect(
      guard.canActivate(contextFor(handlerWith('memory'), CAREGIVER)),
    ).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith('patient-1', 'memory');
  });

  it('상한을 넘으면 429 + Retry-After + 안내 코드', async () => {
    consume.mockResolvedValue({
      allowed: false,
      count: 31,
      limit: 30,
      retryAfterSeconds: 3600,
    });
    const setHeader = jest.fn();

    const error = await guard
      .canActivate(contextFor(handlerWith('memory'), CAREGIVER, setHeader))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    expect(http.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(http.getResponse()).toMatchObject({
      code: DAILY_GENERATION_LIMIT,
      kind: 'memory',
      limit: 30,
      retryAfter: 3600,
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '3600');
  });
});

/**
 * 네 생성 경로에 상한이 붙어 있다 — 하나라도 빠지면 그 경로로 비용이 샌다.
 * AI를 부르지 않는 옆 경로(세션 생성·힌트)에는 붙지 않는다.
 */
describe('생성 경로 배선', () => {
  const controllers = {
    MemoryController,
    QuizController,
    TrainingController,
  };
  type Name = keyof typeof controllers;

  /** 메서드를 떼어 부르지 않고 메타데이터만 읽는다. */
  const handler = (controller: Name, method: string): object =>
    (controllers[controller].prototype as unknown as Record<string, object>)[
      method
    ];
  const capOf = (controller: Name, method: string) =>
    Reflect.getMetadata(DAILY_CAP_KEY, handler(controller, method)) as
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
  ] as const)('%s.%s → %s', (controller, method, kind) => {
    expect(capOf(controller, method)).toBe(kind);
    expect(guardsOf(controller, method)).toContain(DailyCapGuard);
  });

  it.each([
    ['TrainingController', 'createSession'],
    ['TrainingController', 'incrementHint'],
    ['MemoryController', 'update'],
  ] as const)('%s.%s 에는 상한이 없다', (controller, method) => {
    expect(capOf(controller, method)).toBeUndefined();
  });
});
