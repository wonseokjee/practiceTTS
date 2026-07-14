/**
 * 일시적 업스트림 오류에 대한 지수 백오프 재시도.
 *
 * 배경: ai-service를 거쳐 Gemini로 나가는 호출(/mask, /quiz/generate)은 라이프로그
 * 1건당 여러 번 몰려 나가 레이트리밋/일시 오류(429·502·503·504)를 맞는다.
 * 재시도가 없으면 일시적 실패가 곧바로 영구 실패로 굳어(퀴즈 generationStatus=failed)
 * 보호자가 글을 써도 퀴즈가 조용히 안 만들어진다.
 *
 * 4xx 중 재시도해도 소용없는 것(400·404·422 등)은 즉시 던진다.
 */

/** 재시도할 가치가 있는 HTTP status (일시적) */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryOptions {
  /** 최초 시도를 포함한 총 시도 횟수 */
  attempts?: number;
  /** 첫 재시도 대기(ms). 이후 2배씩 증가한다. */
  baseDelayMs?: number;
  /** 대기 상한(ms) */
  maxDelayMs?: number;
}

const DEFAULTS: Required<RetryOptions> = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

/** axios 에러에서 HTTP status 추출 (응답이 없으면 undefined = 네트워크/타임아웃) */
function extractStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  if (response && typeof response.status === 'number') {
    return response.status;
  }
  return undefined;
}

/**
 * 재시도 대상 여부.
 * - 응답이 없는 오류(네트워크 단절·타임아웃)는 재시도한다.
 * - 응답이 있으면 status가 일시적 오류일 때만 재시도한다.
 */
export function isRetryable(error: unknown): boolean {
  const status = extractStatus(error);
  if (status === undefined) return true;
  return RETRYABLE_STATUSES.has(status);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fn을 실행하고, 일시적 오류면 지수 백오프로 재시도한다.
 * 마지막 시도까지 실패하면 마지막 오류를 그대로 던진다(호출자의 에러 매핑 유지).
 *
 * @param onRetry 재시도 직전 호출(로깅용). 예외를 던지지 않아야 한다.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts;
      if (isLast || !isRetryable(error)) {
        throw error;
      }
      // 지수 백오프 + 지터(동시 요청이 같은 시점에 재시도해 다시 몰리는 것을 방지)
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = Math.round(backoff * (0.5 + Math.random() * 0.5));
      onRetry?.(attempt, delayMs, error);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
