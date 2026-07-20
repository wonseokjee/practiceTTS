/**
 * 슬라이딩 윈도우 레이트리미터 (인메모리, 무의존성).
 *
 * ai-service의 같은 이름 구현을 백엔드로 옮겨온 것이다. 다만 키가 다르다 —
 * ai-service는 소켓 IP로 버킷을 나눴는데, 음성 경로를 백엔드 프록시 뒤로
 * 옮기면서 ai-service가 보는 IP가 **전부 백엔드 하나**가 됐다. 그래서 그쪽
 * 제한은 전 사용자 합산 전역 한도로 바뀌었고, 한 사람이 한도를 소진하면
 * 모두가 잠긴다. 여기서 **인증된 사용자 ID**로 나눠야 격리가 돌아온다.
 *
 * 단일 프로세스 메모리라 다중 워커·수평 확장 시에는 공유 저장소(Redis 등)가
 * 필요하다. 지금은 단일 프로세스라 이걸로 충분하다.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  /** 허용되면 true, 한도를 넘으면 false. */
  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    this.prune(cutoff);

    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (timestamps.length >= this.maxRequests) {
      this.hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }

  /**
   * 다시 시도 가능해질 때까지 남은 초(올림). 한도에 걸리지 않았으면 0.
   *
   * 429에 Retry-After를 실어주지 않으면 클라이언트가 즉시 재시도 루프에
   * 빠지기 쉽다 — 막으려던 부하를 오히려 키운다.
   */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const cutoff = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (timestamps.length < this.maxRequests) {
      return 0;
    }
    // 가장 오래된 기록이 창을 벗어나는 순간 한 자리가 난다.
    const oldest = Math.min(...timestamps);
    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }

  /**
   * 창을 벗어난 키를 걷어낸다.
   *
   * 안 하면 서로 다른 키가 들어올 때마다 맵이 무한히 자란다 — 보호장치가
   * 오히려 메모리 고갈 경로가 된다.
   */
  private prune(cutoff: number): void {
    for (const [key, timestamps] of this.hits) {
      const alive = timestamps.filter((t) => t > cutoff);
      if (alive.length === 0) {
        this.hits.delete(key);
      } else if (alive.length !== timestamps.length) {
        this.hits.set(key, alive);
      }
    }
  }
}
