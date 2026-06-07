import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * 파일 저장 경로 및 공개 URL 관리 서비스
 * - 로컬 저장소 구현체
 * - Azure Blob 또는 S3로 교체 시 getPublicUrl()/delete() 구현만 변경
 */
@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);

  /** 업로드 파일이 저장되는 디렉토리 경로 */
  readonly uploadDir: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = this.configService.get<string>(
      'UPLOAD_DIR',
      'tts-cache/memory-images',
    );
  }

  /**
   * 파일명을 공개 접근 가능한 URL로 변환
   * @param filename UUID 기반 파일명 (예: a1b2c3.jpg)
   * @returns 공개 URL (예: /uploads/memory-images/a1b2c3.jpg)
   */
  getPublicUrl(filename: string): string {
    return `/uploads/memory-images/${filename}`;
  }

  /**
   * 업로드 디렉토리에 저장된 파일을 삭제한다.
   * - 트랜잭션 롤백 시 고아 파일 cleanup 용도 (P1-N6=(a)).
   * - 파일이 이미 없으면(ENOENT) 조용히 통과한다.
   * - 그 외 오류는 호출자(best-effort cleanup)가 흡수하도록 throw한다.
   *
   * @param filename UUID 기반 파일명 (경로 구분자 포함 불가)
   */
  async delete(filename: string): Promise<void> {
    if (!filename) {
      return;
    }
    const filePath = join(this.uploadDir, filename);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      this.logger.warn(`파일 삭제 실패: ${filePath}`);
      throw error;
    }
  }
}
