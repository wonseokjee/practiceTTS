import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 파일 저장 경로 및 공개 URL 관리 서비스
 * - 로컬 저장소 구현체
 * - Azure Blob 또는 S3로 교체 시 getPublicUrl() 구현만 변경
 */
@Injectable()
export class FileStorageService {
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
}
