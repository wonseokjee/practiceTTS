interface CapturedCommand {
  __type: string;
  input: Record<string, unknown>;
}

const sendMock = jest.fn<Promise<unknown>, [CapturedCommand]>();
let lastClientConfig: Record<string, unknown> | undefined;

function capturedCommand(callIndex: number): CapturedCommand {
  const command: unknown = sendMock.mock.calls[callIndex][0];
  return command as CapturedCommand;
}

// S3Client 생성을 가로채 endpoint/credentials가 R2 규격으로 만들어지는지,
// send()에 어떤 커맨드가 들어가는지를 네트워크 없이 검증한다.
jest.mock('@aws-sdk/client-s3', () => {
  const makeCommandMock = (type: string) =>
    jest.fn().mockImplementation((input: Record<string, unknown>) => ({
      __type: type,
      input,
    }));

  return {
    S3Client: jest
      .fn()
      .mockImplementation((config: Record<string, unknown>) => {
        lastClientConfig = config;
        return { send: sendMock };
      }),
    PutObjectCommand: makeCommandMock('PutObjectCommand'),
    GetObjectCommand: makeCommandMock('GetObjectCommand'),
    DeleteObjectCommand: makeCommandMock('DeleteObjectCommand'),
  };
});

import { R2PhotoStorageDriver } from './r2-photo-storage.driver';

describe('R2PhotoStorageDriver', () => {
  let driver: R2PhotoStorageDriver;

  beforeEach(() => {
    sendMock.mockReset();
    lastClientConfig = undefined;
    driver = new R2PhotoStorageDriver({
      accountId: 'acc123',
      accessKeyId: 'key-id',
      secretAccessKey: 'secret',
      bucket: 'test-bucket',
    });
  });

  it('R2 엔드포인트(계정별 서브도메인)·region auto·자격증명으로 S3Client를 만든다', () => {
    expect(lastClientConfig).toMatchObject({
      region: 'auto',
      endpoint: 'https://acc123.r2.cloudflarestorage.com',
      credentials: { accessKeyId: 'key-id', secretAccessKey: 'secret' },
    });
  });

  it('save는 PutObjectCommand로 버킷·키·버퍼를 보낸다', async () => {
    sendMock.mockResolvedValue({});
    const bytes = Buffer.from('bytes');

    await driver.save(bytes, 'x.jpg');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = capturedCommand(0);
    expect(command.__type).toBe('PutObjectCommand');
    expect(command.input).toEqual({
      Bucket: 'test-bucket',
      Key: 'x.jpg',
      Body: bytes,
    });
  });

  it('readAsBase64는 GetObjectCommand 응답의 Body를 base64로 변환한다', async () => {
    const transformToByteArray = jest
      .fn()
      .mockResolvedValue(new Uint8Array(Buffer.from('hello')));
    sendMock.mockResolvedValue({ Body: { transformToByteArray } });

    const result = await driver.readAsBase64('x.jpg');

    expect(capturedCommand(0).input).toEqual({
      Bucket: 'test-bucket',
      Key: 'x.jpg',
    });
    expect(Buffer.from(result, 'base64').toString()).toBe('hello');
  });

  it('readAsBase64는 Body가 없으면 throw한다', async () => {
    sendMock.mockResolvedValue({});

    await expect(driver.readAsBase64('missing.jpg')).rejects.toThrow();
  });

  it('readStream도 Body가 없으면 throw한다 (컨트롤러가 404로 변환할 수 있게)', async () => {
    sendMock.mockResolvedValue({});

    await expect(driver.readStream('missing.jpg')).rejects.toThrow();
  });

  it('readStream은 GetObjectCommand 응답의 Body를 그대로 돌려준다', async () => {
    const fakeReadable = { pipe: jest.fn() };
    sendMock.mockResolvedValue({ Body: fakeReadable });

    const stream = await driver.readStream('x.jpg');

    expect(stream).toBe(fakeReadable);
  });

  it('delete는 DeleteObjectCommand로 버킷·키를 보낸다', async () => {
    sendMock.mockResolvedValue({});

    await driver.delete('x.jpg');

    const command = capturedCommand(0);
    expect(command.__type).toBe('DeleteObjectCommand');
    expect(command.input).toEqual({ Bucket: 'test-bucket', Key: 'x.jpg' });
  });
});
