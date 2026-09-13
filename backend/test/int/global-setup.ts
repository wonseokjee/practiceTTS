import 'dotenv/config';
import { execSync } from 'child_process';
import { join } from 'path';
import { DataSource } from 'typeorm';
import {
  TEST_DATABASE,
  assertTestDatabaseName,
  cliEnvForTestDatabase,
  connectionOptions,
} from './test-database';

/** backend/ — `npm run migration:*`을 돌리는 자리. */
export const BACKEND_DIR = join(__dirname, '..', '..');

/**
 * 통합 테스트 레인 준비: 빈 테스트 DB를 새로 만들고 마이그레이션을 끝까지 돌린다.
 *
 * ```
 *   이름 가드 ── _test로 안 끝나면 여기서 throw (DB에 아무것도 안 함)
 *       │
 *   postgres(관리 DB)에 붙어 DROP IF EXISTS → CREATE   ← 이전 실행 잔여물 제거
 *       │
 *   npm run migration:run (DB_DATABASE=practivetts_test)
 *       │                  ↑ DEPLOYMENT.md "배포 전 확인"과 같은 경로
 *   테스트 실행 → globalTeardown이 DROP
 * ```
 *
 * 마이그레이션을 CLI로 돌리는 이유: 앱과 배포가 쓰는 그 경로가 빈 DB에서 끝까지
 * 가는지를 증명하려는 것이다. 테스트 안에서 TypeORM API로 따로 돌리면 다른 경로를
 * 검증하게 된다.
 */
export default async function globalSetup(): Promise<void> {
  assertTestDatabaseName(TEST_DATABASE);

  const admin = await new DataSource(
    connectionOptions('postgres'),
  ).initialize();
  try {
    // WITH (FORCE): 이전 실행이 죽어 연결이 남아 있어도 지운다(PG 13+).
    await admin.query(
      `DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`,
    );
    await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  } finally {
    await admin.destroy();
  }

  try {
    execSync('npm run migration:run', {
      cwd: BACKEND_DIR,
      env: cliEnvForTestDatabase(),
      stdio: 'pipe',
    });
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `빈 테스트 DB에서 마이그레이션이 끝까지 가지 못했습니다.\n` +
        `${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? ''}`,
    );
  }
}
