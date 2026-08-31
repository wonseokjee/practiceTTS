import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // 스키마는 **어느 환경에서든 마이그레이션이 소유한다.**
        //
        // 개발에서만 `synchronize`를 켜 두었는데, 그게 개발 DB를 조용히 부쉈다.
        // 실측(2026-08-31): `migrations` 테이블에는 `AddQabCueLevel`이 적용됐다고
        // 남아 있는데 `qab_results.cue_level` 컬럼이 없었다. 마이그레이션은 평범한
        // `ADD COLUMN`이라 조용히 넘어갈 수가 없다 — 만들어진 뒤 누가 지운 것이다.
        //
        // 범인은 synchronize다. 엔티티에 없는 컬럼을 **DROP한다.** 브랜치를 오가며
        // 작업하다 `cueLevel`이 아직 없던 브랜치에서 백엔드가 한 번 뜨면 그때 날아간다.
        // 그리고 마이그레이션 기록은 남아 있어 `migration:run`으로도 안 돌아온다 —
        // 손으로 기록을 지워야 복구된다.
        //
        // 끄면 잃는 것이 없다. 마이그레이션이 이미 모든 스키마 변경을 담고 있고,
        // 엔티티를 고쳤으면 마이그레이션도 같이 쓰는 것이 원래 절차다.
        // 새 컬럼이 필요하면: `npm run migration:generate` → `npm run migration:run`.

        return {
          type: 'postgres',
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_DATABASE', 'memorylink'),
          autoLoadEntities: true,
          // 절대 켜지 않는다. 위 주석 참고 — 개발 DB를 조용히 부순다.
          synchronize: false,
          // 부팅 시 자동 실행하지 않는다 — 마이그레이션은 CLI로 명시 실행한다.
          migrationsRun: false,
          logging: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
