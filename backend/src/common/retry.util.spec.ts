import { isRetryable, retryTransient } from './retry.util';

/** axios 형태의 HTTP 에러 */
function httpError(status: number): unknown {
  return { response: { status } };
}

/** 지수 백오프 대기를 즉시 통과시켜 테스트를 빠르게 유지한다. */
function useFakeTimers(): void {
  jest
    .spyOn(global, 'setTimeout')
    .mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
}

describe('isRetryable', () => {
  it.each([408, 429, 500, 502, 503, 504])(
    '%i은 일시적 오류로 보고 재시도한다',
    (status) => {
      expect(isRetryable(httpError(status))).toBe(true);
    },
  );

  it.each([400, 401, 403, 404, 413, 422])(
    '%i은 재시도해도 소용없으므로 재시도하지 않는다',
    (status) => {
      expect(isRetryable(httpError(status))).toBe(false);
    },
  );

  it('응답이 없는 오류(네트워크 단절·타임아웃)는 재시도한다', () => {
    expect(isRetryable(new Error('ECONNREFUSED'))).toBe(true);
  });
});

describe('retryTransient', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    useFakeTimers();
  });

  it('성공하면 재시도하지 않는다', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(retryTransient(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('일시적 오류(502)는 재시도해서 성공시킨다', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(httpError(502))
      .mockResolvedValue('ok');

    await expect(retryTransient(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('레이트리밋(429)도 재시도한다', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValue('ok');

    await expect(retryTransient(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('영구 오류(400)는 즉시 던지고 재시도하지 않는다', async () => {
    const fn = jest.fn().mockRejectedValue(httpError(400));

    await expect(retryTransient(fn)).rejects.toEqual(httpError(400));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('시도 횟수를 모두 소진하면 마지막 오류를 그대로 던진다', async () => {
    const fn = jest.fn().mockRejectedValue(httpError(502));

    await expect(retryTransient(fn, { attempts: 3 })).rejects.toEqual(
      httpError(502),
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('재시도 직전 onRetry 콜백으로 알린다', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue('ok');
    const onRetry = jest.fn();

    await retryTransient(fn, {}, onRetry);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1); // attempt
    expect(typeof onRetry.mock.calls[0][1]).toBe('number'); // delayMs
  });
});
