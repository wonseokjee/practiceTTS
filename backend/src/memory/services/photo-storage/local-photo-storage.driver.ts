import { createReadStream, promises as fs } from 'fs';
import type { Readable } from 'stream';
import { join } from 'path';
import {
  DEFAULT_UPLOAD_DIR,
  resolveUploadDir,
} from '../../../common/upload-path';
import type { IPhotoStorageDriver } from './photo-storage-driver.interface';

/** 로컬 디스크에 사진을 저장하는 드라이버. 단일 인스턴스 배포의 기본값. */
export class LocalPhotoStorageDriver implements IPhotoStorageDriver {
  readonly uploadDir: string;

  constructor(uploadDirSetting: string | undefined) {
    this.uploadDir = resolveUploadDir(uploadDirSetting ?? DEFAULT_UPLOAD_DIR);
  }

  async save(buffer: Buffer, filename: string): Promise<void> {
    // 디렉토리가 없으면 쓰기가 ENOENT로 실패하므로 매번 보장한다(이미 있으면 no-op).
    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.writeFile(join(this.uploadDir, filename), buffer);
  }

  async readStream(filename: string): Promise<Readable> {
    const filePath = join(this.uploadDir, filename);
    // 존재하지 않으면 즉시 확인해 ENOENT를 던진다 — createReadStream 자체는
    // 스트림을 비동기로 열어 에러가 'error' 이벤트로만 발생하므로, 호출자가
    // try/catch로 404 변환을 하려면 여기서 먼저 stat해야 한다.
    await fs.stat(filePath);
    return createReadStream(filePath);
  }

  async readAsBase64(filename: string): Promise<string> {
    const buffer = await fs.readFile(join(this.uploadDir, filename));
    return buffer.toString('base64');
  }

  async delete(filename: string): Promise<void> {
    try {
      await fs.unlink(join(this.uploadDir, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}
