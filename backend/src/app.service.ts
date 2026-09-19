import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** DB가 응답하지 않을 때 감시기가 무한정 매달리지 않도록 자르는 시간(ms). */
const HEALTH_DB_TIMEOUT_MS = 3000;

@Injectable()
export class AppService {
  constructor(private readonly dataSource: DataSource) {}

  getHello(): string {
    return 'Hello World!';
  }

  /**
   * 외부 감시(UptimeRobot 등)용 상태 확인 — DB에 `SELECT 1`이 통하는지 본다.
   * 인증 없이 열리므로 실패 원인은 응답에 싣지 않는다(상태만, 상세는 로그).
   */
  async checkHealth(): Promise<{ status: 'ok' }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('health DB check timed out')),
        HEALTH_DB_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  }
}
