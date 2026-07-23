import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

/**
 * TypeORM CLI 전용 DataSource (마이그레이션 실행/되돌리기/생성).
 *
 * 앱 런타임 연결은 DatabaseModule(TypeOrmModule.forRootAsync)이 담당하고,
 * 이 파일은 `npm run migration:*` 스크립트가 쓰는 CLI 진입점이다.
 * synchronize는 항상 false — 스키마 변경은 마이그레이션으로만 이뤄진다.
 *
 * 사용:
 *   npm run migration:show     # 적용 현황
 *   npm run migration:run      # 미적용 마이그레이션 실행
 *   npm run migration:revert   # 마지막 마이그레이션 되돌리기
 */
config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_DATABASE ?? 'memorylink',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: ['error', 'migration'],
});
