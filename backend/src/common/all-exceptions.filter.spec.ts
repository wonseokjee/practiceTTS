import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** 로그 문구는 검사하되 실제 콘솔에는 안 남긴다. */
function silence(method: 'error' | 'warn'): jest.SpyInstance {
  return jest
    .spyOn(Logger.prototype, method)
    .mockImplementation(() => undefined);
}

/** 스파이가 받은 첫 호출의 첫 인자(로그 문구)를 문자열로 꺼낸다. */
function firstLoggedArg(spy: jest.SpyInstance): string {
  const calls = spy.mock.calls as unknown[][];
  return calls[0]?.[0] as string;
}

function buildHost(overrides?: {
  method?: string;
  path?: string;
  body?: unknown;
}): { host: ArgumentsHost; reply: jest.Mock } {
  const reply = jest.fn();
  const response = { __marker: 'res' };
  const request = {
    method: overrides?.method ?? 'POST',
    path: overrides?.path ?? '/quiz/qab-results',
    body: overrides?.body,
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

function buildFilter(reply: jest.Mock): AllExceptionsFilter {
  const httpAdapterHost = {
    httpAdapter: { reply },
  } as unknown as HttpAdapterHost;
  return new AllExceptionsFilter(httpAdapterHost);
}

describe('AllExceptionsFilter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('4xx는 warn으로, path·status·예외명을 남기고 값은 남기지 않는다', () => {
    const warn = silence('warn');
    const { host, reply } = buildHost({
      body: { familyName: '김철수', memo: '아들 이름은 영수' },
    });
    const filter = buildFilter(reply);

    filter.catch(
      new ForbiddenException('환자 데이터에 접근할 수 없는 역할입니다.'),
      host,
    );

    const line = firstLoggedArg(warn);
    expect(line).toContain('POST /quiz/qab-results → 403');
    expect(line).toContain('ForbiddenException');
    expect(line).not.toContain('김철수');
    expect(line).not.toContain('영수');
    expect(line).not.toContain('환자 데이터에 접근할 수 없는 역할입니다.');
  });

  it('검증 실패(400)는 필드명만 뽑는다 — 값·서술어는 안 남긴다', () => {
    const warn = silence('warn');
    const { host, reply } = buildHost();
    const filter = buildFilter(reply);

    filter.catch(
      new BadRequestException([
        'patientId should not be empty',
        'answeredAt must be a valid ISO 8601 date string',
        'patientId must be a UUID', // 같은 필드 중복 → 한 번만
      ]),
      host,
    );

    const line = firstLoggedArg(warn);
    expect(line).toContain('fields=[patientId,answeredAt]');
    expect(line).not.toContain('should not be empty');
    expect(line).not.toContain('UUID');
  });

  it('5xx(비-HttpException)는 error로 남기고 스택을 붙인다', () => {
    const error = silence('error');
    const { host, reply } = buildHost();
    const filter = buildFilter(reply);
    const cause = new Error('DB connection refused');

    filter.catch(cause, host);

    const [line, stack] = error.mock.calls[0] as [string, string | undefined];
    expect(line).toContain('→ 500');
    expect(line).toContain('Error');
    expect(stack).toBe(cause.stack);
  });

  it('2xx가 나올 일은 없지만, 400 미만이면 아무것도 로그하지 않는다', () => {
    const warn = silence('warn');
    const error = silence('error');
    const { host, reply } = buildHost();
    const filter = buildFilter(reply);

    // HttpException 서브클래스 중 상태값이 400 미만인 것은 없지만, 방어적으로
    // 같은 경로를 타는지 확인한다 — 200대라면 warn/error 둘 다 안 불린다.
    class OkResponse extends BadRequestException {
      getStatus(): number {
        return 200;
      }
    }
    filter.catch(new OkResponse('no-op'), host);

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('클라이언트로 나가는 응답 본문은 HttpException의 것을 그대로 쓴다', () => {
    const silenceLogs = silence('warn');
    const { host, reply } = buildHost();
    const filter = buildFilter(reply);

    filter.catch(new ForbiddenException('막힘'), host);

    expect(reply).toHaveBeenCalledWith(
      { __marker: 'res' },
      { statusCode: 403, message: '막힘', error: 'Forbidden' },
      403,
    );
    silenceLogs.mockRestore();
  });

  it('비-HttpException은 NestJS 기본과 같은 500 본문을 준다', () => {
    const silenceLogs = silence('error');
    const { host, reply } = buildHost();
    const filter = buildFilter(reply);

    filter.catch(new Error('boom'), host);

    expect(reply).toHaveBeenCalledWith(
      { __marker: 'res' },
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
    silenceLogs.mockRestore();
  });
});
