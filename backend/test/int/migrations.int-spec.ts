import { execSync } from 'child_process';
import { DataSource } from 'typeorm';
import { BACKEND_DIR } from './global-setup';
import { cliEnvForTestDatabase, openTestDataSource } from './test-database';

/**
 * 빈 DB에서 마이그레이션 체인이 끝까지 가고, 그 결과가 엔티티와 같다.
 *
 * 이 테스트 전에는 **빈 DB에서 전체 체인이 도는지 증명된 적이 없다.** 초기
 * 마이그레이션 몇 개는 "개발 DB는 synchronize가 먼저 반영했다"는 전제로 멱등하게
 * 쓰였고, 드리프트 점검(`schema:log`)도 이미 있는 개발 DB에 대고만 돌렸다
 * (영어판 실행 계획 §14 6-1, 외부 의견 #9).
 *
 * globalSetup이 빈 DB에 `migration:run`을 이미 돌렸다 — 실패했다면 여기 오기 전에
 * 레인 전체가 멈췄다. 이 파일은 그 결과를 확인한다.
 */
describe('마이그레이션 (빈 DB)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const cli = (command: string): string =>
    execSync(command, {
      cwd: BACKEND_DIR,
      env: cliEnvForTestDatabase(),
      stdio: 'pipe',
    }).toString();

  it('마이그레이션이 적용됐고, 적용 안 된 것이 없다', async () => {
    const rows: { n: number }[] = await ds.query(
      'SELECT count(*)::int AS n FROM migrations',
    );
    expect(rows[0].n).toBeGreaterThan(0);

    // migration:show는 적용분을 [X], 미적용분을 [ ]로 찍는다.
    const shown = cli('npm run migration:show');
    expect(shown).toMatch(/\[X\]/);
    expect(shown).not.toMatch(/\[ \]/);
  });

  it('스키마가 엔티티와 같다 — schema:log 드리프트 0', () => {
    const log = cli(
      'npx typeorm-ts-node-commonjs schema:log -d src/database/data-source.ts',
    );
    expect(log).toMatch(/Your schema is up to date/);
  });
});
