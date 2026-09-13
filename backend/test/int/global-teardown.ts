import 'dotenv/config';
import { DataSource } from 'typeorm';
import {
  TEST_DATABASE,
  assertTestDatabaseName,
  connectionOptions,
} from './test-database';

/** 테스트가 끝나면 테스트 DB를 지운다. 지우기 전에 이름 가드를 다시 건다. */
export default async function globalTeardown(): Promise<void> {
  assertTestDatabaseName(TEST_DATABASE);

  const admin = await new DataSource(
    connectionOptions('postgres'),
  ).initialize();
  try {
    await admin.query(
      `DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`,
    );
  } finally {
    await admin.destroy();
  }
}
