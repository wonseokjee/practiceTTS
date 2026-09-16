import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { extname } from 'path';
import { LocalPhotoStorageDriver } from './photo-storage/local-photo-storage.driver';
import { R2PhotoStorageDriver } from './photo-storage/r2-photo-storage.driver';
import type { IPhotoStorageDriver } from './photo-storage/photo-storage-driver.interface';

/**
 * 파일 저장 경로 및 공개 URL 관리 서비스.
 *
 * 물리적 저장은 PHOTO_STORAGE_DRIVER(local|r2, 기본 local)로 고른 드라이버에
 * 위임한다. 어느 드라이버를 쓰든 photoUrl 저장 형식(getPublicUrl)과 파일명
 * 생성 규칙(UUID+확장자)은 이 클래스가 고정한다 — 드라이버는 바이트 저장/조회/
 * 삭제만 안다(gstack /cso 이후 R2 마이그레이션: 서버 저렴화를 위해 1인스턴스
 * 전제는 유지하되 사진만 R2로 옮길 수 있게).
 */
@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly driver: IPhotoStorageDriver;

  constructor(private readonly configService: ConfigService) {
    const driverName = this.configService.get<string>(
      'PHOTO_STORAGE_DRIVER',
      'local',
    );

    if (driverName === 'r2') {
      const accountId = this.configService.get<string>('R2_ACCOUNT_ID', '');
      const accessKeyId = this.configService.get<string>(
        'R2_ACCESS_KEY_ID',
        '',
      );
      const secretAccessKey = this.configService.get<string>(
        'R2_SECRET_ACCESS_KEY',
        '',
      );
      const bucket = this.configService.get<string>('R2_BUCKET', '');

      const missing = [
        ['R2_ACCOUNT_ID', accountId],
        ['R2_ACCESS_KEY_ID', accessKeyId],
        ['R2_SECRET_ACCESS_KEY', secretAccessKey],
        ['R2_BUCKET', bucket],
      ]
        .filter(([, value]) => !value)
        .map(([name]) => name);

      if (missing.length > 0) {
        // 경고만 남기고 local로 폴백하면 "R2를 켰다고 생각했는데 사실 로컬
        // 디스크에 쓰고 있었다"는 조용한 실패가 된다 — 명시적으로 고른
        // 드라이버가 설정 미비면 부팅을 막는다.
        throw new Error(
          `[FileStorageService] PHOTO_STORAGE_DRIVER=r2인데 다음 값이 ` +
            `비어 있습니다: ${missing.join(', ')}`,
        );
      }

      this.driver = new R2PhotoStorageDriver({
        accountId,
        accessKeyId,
        secretAccessKey,
        bucket,
      });
    } else {
      this.driver = new LocalPhotoStorageDriver(
        this.configService.get<string>('UPLOAD_DIR'),
      );
    }
  }

  /**
   * 업로드된 사진 버퍼를 저장하고, 생성한 파일명을 반환한다.
   * @param buffer 사진 바이트 (multer memoryStorage로 받은 원본)
   * @param originalname 확장자 판별용 원본 파일명
   * @returns UUID 기반 파일명 (예: a1b2c3.jpg) — getPublicUrl 등에 사용
   */
  async save(buffer: Buffer, originalname: string): Promise<string> {
    const filename = `${randomUUID()}${extname(originalname).toLowerCase()}`;
    await this.driver.save(buffer, filename);
    return filename;
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
   * 저장된 파일을 스트림으로 연다 (MemoryPhotoController가 StreamableFile로 감싼다).
   * 파일이 없으면 throw — 호출자가 404로 변환한다.
   */
  async readStream(filename: string): Promise<Readable> {
    return this.driver.readStream(filename);
  }

  /**
   * 저장된 파일을 Base64 문자열로 읽는다.
   * - FastAPI /tag 호출 시 image_base64 페이로드로 전달하기 위함.
   * - 파일이 없거나 읽기 실패 시 throw (호출자가 best-effort로 흡수).
   */
  async readAsBase64(filename: string): Promise<string> {
    return this.driver.readAsBase64(filename);
  }

  /**
   * 저장된 파일을 삭제한다.
   * - 트랜잭션 롤백 시 고아 파일 cleanup 용도 (P1-N6=(a)).
   * - 파일이 이미 없으면 조용히 통과한다(드라이버가 보장).
   */
  async delete(filename: string): Promise<void> {
    if (!filename) {
      return;
    }
    try {
      await this.driver.delete(filename);
    } catch (error) {
      this.logger.warn(`파일 삭제 실패: ${filename}`);
      throw error;
    }
  }
}
