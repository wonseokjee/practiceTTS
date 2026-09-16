jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ConfigService } from '@nestjs/config';
import { FileStorageService } from './file-storage.service';

/** ConfigService를 흉내내는 최소 페이크 — Map 기반 get(key, default). */
function fakeConfigService(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, defaultValue?: string) => values[key] ?? defaultValue,
  } as unknown as ConfigService;
}

describe('FileStorageService — 드라이버 선택', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-storage-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('PHOTO_STORAGE_DRIVER 미설정 시 local을 쓴다 (기본값)', async () => {
    const service = new FileStorageService(
      fakeConfigService({ UPLOAD_DIR: tmp }),
    );

    const filename = await service.save(Buffer.from('local-bytes'), 'a.jpg');
    const base64 = await service.readAsBase64(filename);

    expect(Buffer.from(base64, 'base64').toString()).toBe('local-bytes');
    expect(service.getPublicUrl(filename)).toBe(
      `/uploads/memory-images/${filename}`,
    );
  });

  it('save는 UUID 기반 파일명을 생성하고 원본 확장자를 보존한다', async () => {
    const service = new FileStorageService(
      fakeConfigService({ UPLOAD_DIR: tmp }),
    );

    const filename = await service.save(Buffer.from('x'), 'photo.PNG');

    expect(filename).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
    );
  });

  it('알 수 없는 PHOTO_STORAGE_DRIVER 값도 local로 폴백한다', async () => {
    const service = new FileStorageService(
      fakeConfigService({ PHOTO_STORAGE_DRIVER: 'typo', UPLOAD_DIR: tmp }),
    );

    await expect(
      service.save(Buffer.from('x'), 'a.jpg'),
    ).resolves.toBeDefined();
  });

  it('PHOTO_STORAGE_DRIVER=r2인데 설정이 비면 부팅을 막는다', () => {
    expect(
      () =>
        new FileStorageService(
          fakeConfigService({ PHOTO_STORAGE_DRIVER: 'r2' }),
        ),
    ).toThrow(/R2_ACCOUNT_ID/);
  });

  it('PHOTO_STORAGE_DRIVER=r2인데 일부만 비어도 부팅을 막는다', () => {
    expect(
      () =>
        new FileStorageService(
          fakeConfigService({
            PHOTO_STORAGE_DRIVER: 'r2',
            R2_ACCOUNT_ID: 'acc',
            R2_ACCESS_KEY_ID: 'key',
            // R2_SECRET_ACCESS_KEY, R2_BUCKET 누락
          }),
        ),
    ).toThrow(
      /R2_SECRET_ACCESS_KEY.*R2_BUCKET|R2_BUCKET.*R2_SECRET_ACCESS_KEY/,
    );
  });

  it('PHOTO_STORAGE_DRIVER=r2이고 설정이 전부 있으면 정상 생성된다', () => {
    expect(
      () =>
        new FileStorageService(
          fakeConfigService({
            PHOTO_STORAGE_DRIVER: 'r2',
            R2_ACCOUNT_ID: 'acc',
            R2_ACCESS_KEY_ID: 'key',
            R2_SECRET_ACCESS_KEY: 'secret',
            R2_BUCKET: 'bucket',
          }),
        ),
    ).not.toThrow();
  });
});
