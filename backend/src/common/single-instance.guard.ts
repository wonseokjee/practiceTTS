import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * 이 앱은 **단일 인스턴스 전제**로 만들어져 있다. 그 전제가 깨지는 순간을
 * 부팅 시점에 알린다.
 *
 * 왜 필요한가: 다중 인스턴스로 띄워도 부팅은 멀쩡히 성공한다. 깨지는 건
 * 런타임이고, 그것도 조용히 깨진다.
 *
 *   1. 업로드 사진이 로컬 디스크에 있다. A에 올린 사진을 B가 받으면 404다.
 *      같은 사용자가 새로고침할 때마다 사진이 보였다 안 보였다 한다.
 *   2. TTS 캐시도 로컬 디스크다. 인스턴스 수만큼 Azure를 중복 호출한다
 *      (하이브리드 캐싱 설계 자체가 희석된다).
 *   3. 레이트리밋이 프로세스 메모리다. 실효 한도가 인스턴스 수만큼 곱해진다.
 *   4. 퀴즈 복구 claim이 배타 리스가 아니다. 두 인스턴스가 같은 세트를
 *      동시에 생성해 문항이 두 배가 될 수 있다.
 *
 * 그래서 누가 `instances: 'max'`를 켜면 아무 에러 없이 위 네 가지가 시작된다.
 * 이 가드는 Postgres 세션 advisory lock으로 "지금 다른 인스턴스가 살아 있는가"를
 * 실제로 확인한다. 배포 플랫폼(PM2/Docker/K8s)에 의존하지 않는다.
 *
 * 기본은 **경고**다. 롤링 배포 중에는 잠깐 두 인스턴스가 겹치는 게 정상이라
 * 그때마다 기동을 막으면 배포가 불가능해진다. 다중 인스턴스를 확실히 막고
 * 싶으면 ENFORCE_SINGLE_INSTANCE=true로 기동 실패로 바꾼다.
 *
 * 다중 인스턴스로 전환할 때는 이 가드를 끄기 전에 DEPLOYMENT.md의 이행
 * 순서를 먼저 끝낼 것. 가드만 끄면 위 네 가지가 그대로 발생한다.
 */
@Injectable()
export class SingleInstanceGuard implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SingleInstanceGuard.name);

  /**
   * advisory lock 키. 임의의 64비트 정수이고 앱 전역에서 유일하면 된다.
   * 다른 용도의 advisory lock을 추가한다면 겹치지 않게 할 것.
   */
  private static readonly LOCK_KEY = 8_472_119_003;

  /**
   * 잠금은 **세션 범위**라 이 커넥션을 잡고 있는 동안만 유지된다.
   * 풀에 반납하면 다른 작업이 쓰다가 재활용될 때 풀릴 수 있으므로,
   * 전용 러너를 프로세스 수명 내내 붙들고 있는다.
   */
  private runner: QueryRunner | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enforce =
      this.configService.get<string>('ENFORCE_SINGLE_INSTANCE', '') === 'true';

    let acquired: boolean;
    try {
      this.runner = this.dataSource.createQueryRunner();
      await this.runner.connect();
      const rows = (await this.runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [SingleInstanceGuard.LOCK_KEY],
      )) as { locked: boolean }[];
      acquired = rows[0]?.locked === true;
    } catch (error) {
      // 잠금 확인 자체가 실패하면 앱을 막지 않는다. 이건 보조 장치이지
      // 기능이 아니다 — 여기서 기동을 막으면 DB 일시 장애가 전면 장애가 된다.
      this.logger.warn(
        `단일 인스턴스 확인을 건너뛴다(잠금 조회 실패): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.releaseRunner();
      return;
    }

    if (acquired) {
      this.logger.log('단일 인스턴스로 기동했다.');
      return;
    }

    await this.releaseRunner();

    const message =
      '다른 인스턴스가 이미 실행 중이다. 이 앱은 단일 인스턴스 전제로 만들어져 있어 ' +
      '다중 인스턴스에서는 (1) 업로드 사진이 인스턴스별 로컬 디스크라 404가 나고 ' +
      '(2) TTS 캐시가 갈려 Azure를 중복 호출하며 (3) 레이트리밋 실효 한도가 인스턴스 ' +
      '수만큼 곱해지고 (4) 퀴즈가 중복 생성될 수 있다. 자세한 내용과 전환 순서는 ' +
      'DEPLOYMENT.md 참고.';

    if (enforce) {
      throw new Error(`[SingleInstanceGuard] ${message}`);
    }
    // 롤링 배포 중이면 잠깐 겹치는 게 정상이라 기본은 경고다.
    this.logger.warn(
      `${message} (롤링 배포 중이면 정상이다. 확실히 막으려면 ENFORCE_SINGLE_INSTANCE=true)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.releaseRunner();
  }

  private async releaseRunner(): Promise<void> {
    if (!this.runner) return;
    try {
      await this.runner.release();
    } catch {
      // 종료 경로라 삼킨다. 커넥션이 끊기면 잠금도 함께 풀린다.
    }
    this.runner = null;
  }
}
