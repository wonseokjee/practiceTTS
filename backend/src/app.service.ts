import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

/** DB가 응답하지 않을 때 감시기가 무한정 매달리지 않도록 자르는 시간(ms). */
const HEALTH_DB_TIMEOUT_MS = 3000;
/** 끝난 확인 결과를 다시 쓰는 시간(ms). 이 동안은 DB에 새로 묻지 않는다. */
const HEALTH_CACHE_MS = 3000;

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private probe: Promise<boolean> | null = null;
  private probeSettledAt: number | null = null;

  constructor(private readonly dataSource: DataSource) {}

  getHello(): string {
    return 'Hello World!';
  }

  /**
   * 외부 감시(UptimeRobot 등)용 상태 확인 — DB에 `SELECT 1`이 통하는지 본다.
   * 인증 없이 열리므로 실패 원인은 응답에 싣지 않는다(상태만). 원인은 서버 로그에만 남긴다.
   *
   * 진행 중인 확인이 있으면 그 결과를 함께 기다리고, 끝난 결과는 `HEALTH_CACHE_MS` 동안
   * 다시 쓴다. 타임아웃(`Promise.race`)은 진 쪽 쿼리를 취소하지 못해 커넥션을 쥔 채
   * 남을 수 있는데, 이렇게 하면 동시에 쥐는 커넥션이 최대 1개이고 공개 엔드포인트의
   * DB 부하가 요청 수와 무관하다.
   *
   * **커넥션 풀은 앱과 같이 쓴다.** 느린 쿼리로 풀이 다 차면 이 확인도 줄을 서서
   * 타임아웃 → 503이다. 사용자가 실제로 막히는 상태라 의도한 동작이다.
   * 이 확인은 DB만 본다(ai-service·저장소는 보지 않는다).
   */
  async checkHealth(): Promise<{ status: 'ok' }> {
    const ok = await this.currentProbe();
    if (!ok) {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok' };
  }

  private currentProbe(): Promise<boolean> {
    const reusable =
      this.probe !== null &&
      (this.probeSettledAt === null ||
        Date.now() - this.probeSettledAt < HEALTH_CACHE_MS);
    if (reusable && this.probe !== null) return this.probe;

    const probe = this.runProbe();
    this.probe = probe;
    this.probeSettledAt = null;
    void probe.then(() => {
      if (this.probe === probe) this.probeSettledAt = Date.now();
    });
    return probe;
  }

  private async runProbe(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `health DB check timed out after ${HEALTH_DB_TIMEOUT_MS}ms`,
            ),
          ),
        HEALTH_DB_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return true;
    } catch (err) {
      this.logger.warn(`health DB check failed: ${describeError(err)}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
