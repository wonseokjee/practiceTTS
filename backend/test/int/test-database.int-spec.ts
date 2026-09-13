import { TEST_DATABASE, assertTestDatabaseName } from './test-database';

/**
 * 이름 가드 — 이 레인이 개발·운영 DB를 지우지 않는다는 보증은 전부 여기에 걸려 있다.
 */
describe('assertTestDatabaseName', () => {
  it.each([
    'memorylink', // .env·data-source.ts의 개발 DB
    'postgres', // 관리 DB
    'practivetts',
    'test_practivetts', // 앞에 붙은 test는 소용없다
    'practivetts_test_backup', // _test가 끝이 아니다
    'memorylink_testing',
    '',
  ])('"%s"는 거부한다', (name) => {
    expect(() => assertTestDatabaseName(name)).toThrow(/_test/);
  });

  it('_test로 끝나는 이름은 통과한다', () => {
    expect(() => assertTestDatabaseName('practivetts_test')).not.toThrow();
  });

  it('레인이 쓰는 DB 이름 상수가 가드를 통과한다', () => {
    expect(() => assertTestDatabaseName(TEST_DATABASE)).not.toThrow();
  });
});
