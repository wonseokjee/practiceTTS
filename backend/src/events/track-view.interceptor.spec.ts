import { Reflector } from '@nestjs/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { TrackViewInterceptor } from './track-view.interceptor';
import { EventsService } from './events.service';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}) as unknown,
    getClass: () => ({}) as unknown,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(value: unknown = { ok: true }, err?: Error): CallHandler {
  return { handle: () => (err ? throwError(() => err) : of(value)) };
}

describe('TrackViewInterceptor', () => {
  let recordViewed: jest.Mock;
  let interceptor: TrackViewInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    recordViewed = jest.fn().mockResolvedValue(undefined);
    reflector = new Reflector();
    interceptor = new TrackViewInterceptor(reflector, {
      recordViewed,
    } as unknown as EventsService);
  });

  it('@TrackView가 없는 라우트는 그냥 통과한다 — 기록 안 함', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = makeContext({ user: { id: 'u1' }, headers: {} });

    const result = await firstValueFrom(
      interceptor.intercept(ctx, makeHandler({ x: 1 })),
    );

    expect(result).toEqual({ x: 1 });
    expect(recordViewed).not.toHaveBeenCalled();
  });

  it('성공 응답 뒤 등록된 이벤트 이름으로 기록한다', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue('qab_trend_viewed');
    const ctx = makeContext({
      user: { id: 'u1' },
      headers: { 'x-screen-name': 'dashboard' },
    });

    await firstValueFrom(interceptor.intercept(ctx, makeHandler()));

    expect(recordViewed).toHaveBeenCalledWith('u1', 'qab_trend_viewed', {
      screen: 'dashboard',
    });
  });

  it('헤더가 없으면 unknown으로 기록한다 — 지어내지 않는다', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue('qab_trend_viewed');
    const ctx = makeContext({ user: { id: 'u1' }, headers: {} });

    await firstValueFrom(interceptor.intercept(ctx, makeHandler()));

    expect(recordViewed).toHaveBeenCalledWith('u1', 'qab_trend_viewed', {
      screen: 'unknown',
    });
  });

  it('헤더가 배열로 오면(중복 헤더) 첫 값을 쓴다', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue('qab_trend_viewed');
    const ctx = makeContext({
      user: { id: 'u1' },
      headers: { 'x-screen-name': ['report', 'dup'] },
    });

    await firstValueFrom(interceptor.intercept(ctx, makeHandler()));

    expect(recordViewed).toHaveBeenCalledWith('u1', 'qab_trend_viewed', {
      screen: 'report',
    });
  });

  it('req.user가 없으면 기록을 건너뛴다', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue('qab_trend_viewed');
    const ctx = makeContext({ headers: {} });

    await firstValueFrom(interceptor.intercept(ctx, makeHandler()));

    expect(recordViewed).not.toHaveBeenCalled();
  });

  it('핸들러가 실패하면(에러 응답) 기록하지 않는다 — 실패한 요청을 본 걸로 안 센다', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue('qab_trend_viewed');
    const ctx = makeContext({ user: { id: 'u1' }, headers: {} });

    await expect(
      firstValueFrom(
        interceptor.intercept(ctx, makeHandler(undefined, new Error('boom'))),
      ),
    ).rejects.toThrow('boom');
    expect(recordViewed).not.toHaveBeenCalled();
  });
});
