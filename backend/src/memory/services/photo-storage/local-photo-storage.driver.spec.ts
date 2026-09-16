import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalPhotoStorageDriver } from './local-photo-storage.driver';

describe('LocalPhotoStorageDriver', () => {
  let tmp: string;
  let driver: LocalPhotoStorageDriver;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-storage-test-'));
    driver = new LocalPhotoStorageDriver(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('save 후 readAsBase64로 같은 바이트를 돌려받는다', async () => {
    const original = Buffer.from('hello-photo-bytes');

    await driver.save(original, 'a.jpg');
    const base64 = await driver.readAsBase64('a.jpg');

    expect(Buffer.from(base64, 'base64')).toEqual(original);
  });

  it('save 후 readStream으로 같은 바이트를 스트리밍한다', async () => {
    const original = Buffer.from('stream-me');
    await driver.save(original, 'b.jpg');

    const stream = await driver.readStream('b.jpg');
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks)).toEqual(original);
  });

  it('디렉토리가 없어도 save가 자동으로 만든다', async () => {
    const nested = new LocalPhotoStorageDriver(path.join(tmp, 'nested', 'dir'));

    await expect(
      nested.save(Buffer.from('x'), 'c.jpg'),
    ).resolves.toBeUndefined();
  });

  it('없는 파일을 readStream하면 throw한다 (호출자가 404로 변환)', async () => {
    await expect(driver.readStream('missing.jpg')).rejects.toThrow();
  });

  it('없는 파일을 delete해도 조용히 통과한다', async () => {
    await expect(driver.delete('missing.jpg')).resolves.toBeUndefined();
  });

  it('delete 후 같은 파일을 readAsBase64하면 throw한다', async () => {
    await driver.save(Buffer.from('gone'), 'd.jpg');
    await driver.delete('d.jpg');

    await expect(driver.readAsBase64('d.jpg')).rejects.toThrow();
  });
});
