import { NotFoundException, StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import { MemoryPhotoController } from './memory-photo.controller';
import type { MemoryPhotoService } from './services/memory-photo.service';
import type { FileStorageService } from './services/file-storage.service';

/**
 * MemoryPhotoController — 저장소 드라이버 교체(local/R2) 후에도 서빙 계약이
 * 그대로인지 확인한다. 소유권 판정 자체는 memory-photo.access.spec.ts가 덮는다.
 */
describe('MemoryPhotoController — 서빙 계약', () => {
  const FAKE_USER = { id: 'user-1' } as never;

  let memoryPhotoService: { resolveAccessibleFilename: jest.Mock };
  let fileStorageService: { readStream: jest.Mock };
  let controller: MemoryPhotoController;

  beforeEach(() => {
    memoryPhotoService = { resolveAccessibleFilename: jest.fn() };
    fileStorageService = { readStream: jest.fn() };
    controller = new MemoryPhotoController(
      memoryPhotoService as unknown as MemoryPhotoService,
      fileStorageService as unknown as FileStorageService,
    );
  });

  function req() {
    return { user: FAKE_USER } as never;
  }

  it('저장소(드라이버 무관)에서 정상적으로 읽히면 StreamableFile을 반환한다', async () => {
    memoryPhotoService.resolveAccessibleFilename.mockResolvedValue('a.jpg');
    const stream = Readable.from([Buffer.from('bytes')]);
    fileStorageService.readStream.mockResolvedValue(stream);

    const result = await controller.serve('a.jpg', req());

    expect(result).toBeInstanceOf(StreamableFile);
    expect(fileStorageService.readStream).toHaveBeenCalledWith('a.jpg');
  });

  it('DB엔 있는데 저장소 읽기가 실패하면(드라이버 종류 무관) 404로 변환한다', async () => {
    memoryPhotoService.resolveAccessibleFilename.mockResolvedValue('a.jpg');
    // 로컬이면 ENOENT, R2면 NoSuchKey — 에러 모양이 달라도 똑같이 잡아야 한다.
    fileStorageService.readStream.mockRejectedValue(
      new Error('NoSuchKey: 오브젝트가 없습니다'),
    );

    await expect(controller.serve('a.jpg', req())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('허용되지 않은 확장자는 저장소를 읽기 전에 거부한다', async () => {
    memoryPhotoService.resolveAccessibleFilename.mockResolvedValue('a.exe');

    await expect(controller.serve('a.exe', req())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fileStorageService.readStream).not.toHaveBeenCalled();
  });

  it('소유권 검사를 통과 못하면 저장소를 아예 건드리지 않는다', async () => {
    memoryPhotoService.resolveAccessibleFilename.mockRejectedValue(
      new NotFoundException('사진을 찾을 수 없습니다.'),
    );

    await expect(controller.serve('a.jpg', req())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fileStorageService.readStream).not.toHaveBeenCalled();
  });
});
