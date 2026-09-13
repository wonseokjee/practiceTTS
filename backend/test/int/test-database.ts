import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * 행을 쓰는 통합 테스트가 쓰는 DB.
 *
 * **이름을 환경변수에서 읽지 않고 여기 박아 둔다.** `src/database/data-source.ts`의
 * 기본값은 개발 DB(`memorylink`)이고 `.env`도 그쪽을 가리킨다. 테스트가 그 값을
 * 따라가면 오버라이드 한 줄만 빠뜨려도 globalSetup의 DROP이 개발 DB를 지운다 —
 * 되돌릴 방법이 없다(영어판 실행 계획 §14 3-1A).
 *
 * 읽기 전용 통합 테스트(`src/common/week-boundary.integration.spec.ts`)는 지금처럼
 * 개발 DB에 붙어도 된다. 이 레인은 **행을 쓰는** 테스트를 위한 것이다.
 */
export const TEST_DATABASE = 'practivetts_test';

/**
 * 테스트용이 아닌 DB 이름이면 멈춘다. DROP·CREATE 전에 반드시 부른다.
 *
 * 규칙은 이름 끝이 `_test`인가 하나뿐이다. 이름이 조금 달라도(`memorylink_dev`,
 * `practivetts_test_backup`) 통과시키지 않는다 — 지워도 되는 DB만 지운다.
 */
export function assertTestDatabaseName(name: string): void {
  if (!/_test$/.test(name)) {
    throw new Error(
      `통합 테스트 DB 이름은 _test로 끝나야 합니다: "${name}". ` +
        '개발·운영 DB를 지우지 않도록 여기서 멈춥니다.',
    );
  }
}

/**
 * 서버 접속 정보(호스트·계정)는 `.env`를 따르고, DB 이름은 인자로만 받는다.
 * `DB_DATABASE`는 일부러 읽지 않는다(위 주석).
 */
export function connectionOptions(database: string): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database,
    entities: [],
    synchronize: false,
  };
}

/** 테스트 DB에 붙는다. 이름 가드를 한 번 더 건다. */
export async function openTestDataSource(): Promise<DataSource> {
  assertTestDatabaseName(TEST_DATABASE);
  return new DataSource(connectionOptions(TEST_DATABASE)).initialize();
}

/** 마이그레이션 CLI를 테스트 DB에 대고 돌릴 때 쓰는 환경. */
export function cliEnvForTestDatabase(): NodeJS.ProcessEnv {
  assertTestDatabaseName(TEST_DATABASE);
  return { ...process.env, DB_DATABASE: TEST_DATABASE };
}
