import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // 운영에서는 synchronize를 끄고 마이그레이션이 스키마를 소유한다.
        // (synchronize는 엔티티 변경을 즉시 DDL로 반영해 운영 데이터 유실 위험이 있다.)
        // 배포 절차: NODE_ENV=production + `npm run migration:run`
        const isProduction =
          configService.get<string>('NODE_ENV', 'development') === 'production';

        return {
          type: 'postgres',
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_DATABASE', 'memorylink'),
          autoLoadEntities: true,
          // 개발 환경에서만 스키마 자동 동기화
          synchronize: !isProduction,
          // 부팅 시 자동 실행하지 않는다 — 마이그레이션은 CLI로 명시 실행한다.
          migrationsRun: false,
          logging: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
