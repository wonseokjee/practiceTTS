import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import type { IPhotoStorageDriver } from './photo-storage-driver.interface';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Cloudflare R2(S3 호환 API)에 사진을 저장하는 드라이버.
 *
 * 버킷은 **비공개**로 유지한다 — 사진은 MemoryPhotoController에서 인증 +
 * 소유권 검사를 통과해야만 서빙되는 자원이고(DEPLOYMENT.md 참고), R2 오브젝트를
 * 공개로 돌리면 그 접근 통제가 우회된다. photoUrl은 항상 백엔드 라우트
 * (`/uploads/memory-images/:filename`)를 가리키고, 이 드라이버는 그 라우트
 * 뒤에서만 R2 오브젝트를 읽고 내려보낸다.
 */
export class R2PhotoStorageDriver implements IPhotoStorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: R2Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async save(buffer: Buffer, filename: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: filename,
        Body: buffer,
      }),
    );
  }

  async readStream(filename: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: filename }),
    );
    if (!result.Body) {
      throw new Error(`R2 오브젝트를 읽지 못했습니다: ${filename}`);
    }
    // Node.js 런타임에서 GetObjectCommand의 Body는 Readable이다
    // (브라우저 런타임에서만 ReadableStream/Blob으로 갈라진다).
    return result.Body as Readable;
  }

  async readAsBase64(filename: string): Promise<string> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: filename }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`R2 오브젝트를 읽지 못했습니다: ${filename}`);
    }
    return Buffer.from(bytes).toString('base64');
  }

  async delete(filename: string): Promise<void> {
    // S3/R2의 DeleteObject는 키가 없어도 에러를 던지지 않는다(idempotent) —
    // LocalPhotoStorageDriver의 ENOENT 흡수와 동일한 효과를 별도 처리 없이 얻는다.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: filename }),
    );
  }
}
