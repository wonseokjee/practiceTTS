import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MemoryEntry } from './entities/memory-entry.entity';
import { MemoryController } from './memory.controller';
import { MemoryEntryService } from './memory.service';
import { CryptoService } from './services/crypto.service';
import { FastApiClientService } from './services/fast-api-client.service';
import { FileStorageService } from './services/file-storage.service';

/**
 * 메모리 엔트리 모듈
 * - TypeORM MemoryEntry 엔티티 등록
 * - HttpModule: FastApiClientService가 @nestjs/axios HttpService 사용
 * - AuthModule: JwtAuthGuard 재사용
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([MemoryEntry]),
    // FastApiClientService에서 HttpService 사용
    HttpModule,
    // JwtAuthGuard 재사용
    AuthModule,
  ],
  controllers: [MemoryController],
  providers: [
    MemoryEntryService,
    FastApiClientService,
    CryptoService,
    FileStorageService,
  ],
  exports: [MemoryEntryService],
})
export class MemoryModule {}
