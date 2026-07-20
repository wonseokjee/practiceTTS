import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SingleInstanceGuard } from './single-instance.guard';

/**
 * 다중 인스턴스 감지 회귀 테스트.
 *
 * 배경: 다중 인스턴스로 띄워도 부팅은 성공하고 런타임에만 조용히 깨진다
 * (사진 404, TTS 캐시 분열, 레이트리밋 N배 완화, 퀴즈 중복 생성).
 * 배포 설정 주석만으로는 막히지 않으므로 코드가 실제로 확인한다.
 */
describe('SingleInstanceGuard', () => {
  let released: number;
  let queryCalls: [string, unknown[]][];

  function makeDataSource(lockResult: unknown): DataSource {
    released = 0;
    queryCalls = [];
    return {
      createQueryRunner: () => ({
        connect: () => Promise.resolve(),
        query: (sql: string, params: unknown[]) => {
          queryCalls.push([sql, params]);
          if (lockResult instanceof Error) return Promise.reject(lockResult);
          return Promise.resolve(lockResult);
        },
        release: () => {
          released += 1;
          return Promise.resolve();
        },
      }),
    } as unknown as DataSource;
  }

  function makeConfig(enforce: boolean): ConfigService {
    return {
      get: (key: string, fallback: string) =>
        key === 'ENFORCE_SINGLE_INSTANCE' ? String(enforce) : fallback,
    } as unknown as ConfigService;
  }

  it('잠금을 얻으면 정상 기동하고 커넥션을 붙들고 있는다', async () => {
    const guard = new SingleInstanceGuard(
      makeDataSource([{ locked: true }]),
      makeConfig(false),
    );

    await guard.onModuleInit();

    // advisory lock은 세션 범위다. 커넥션을 반납하면 잠금이 풀려
    // 두 번째 인스턴스가 자기가 유일하다고 착각한다.
    expect(released).toBe(0);
    expect(queryCalls[0][0]).toContain('pg_try_advisory_lock');
  });

  it('잠금을 못 얻으면 기본은 경고 (롤링 배포 중 정상 상황)', async () => {
    const warn = jest
      .spyOn(SingleInstanceGuard.prototype['logger'] ?? console, 'warn')
      .mockImplementation(() => {});
    const guard = new SingleInstanceGuard(
      makeDataSource([{ locked: false }]),
      makeConfig(false),
    );

    // 던지지 않아야 한다 — 그러면 롤링 배포가 불가능해진다.
    await expect(guard.onModuleInit()).resolves.toBeUndefined();

    warn.mockRestore();
  });

  it('ENFORCE_SINGLE_INSTANCE=true면 기동을 막는다', async () => {
    const guard = new SingleInstanceGuard(
      makeDataSource([{ locked: false }]),
      makeConfig(true),
    );

    await expect(guard.onModuleInit()).rejects.toThrow(/다른 인스턴스/);
  });

  it('막을 때 무엇이 깨지는지 알려준다', async () => {
    // 메시지가 "중복 기동"만 말하면 운영자가 심각성을 모른다.
    const guard = new SingleInstanceGuard(
      makeDataSource([{ locked: false }]),
      makeConfig(true),
    );

    await expect(guard.onModuleInit()).rejects.toThrow(/사진|레이트리밋/);
  });

  it('잠금 조회가 실패해도 앱을 막지 않는다', async () => {
    // 보조 장치일 뿐이다. 여기서 기동을 막으면 DB 일시 장애가
    // 전면 장애로 번진다.
    const guard = new SingleInstanceGuard(
      makeDataSource(new Error('connection reset')),
      makeConfig(true),
    );

    await expect(guard.onModuleInit()).resolves.toBeUndefined();
    expect(released).toBe(1);
  });

  it('종료 시 커넥션을 반납한다', async () => {
    const guard = new SingleInstanceGuard(
      makeDataSource([{ locked: true }]),
      makeConfig(false),
    );
    await guard.onModuleInit();

    await guard.onModuleDestroy();

    expect(released).toBe(1);
  });
});
