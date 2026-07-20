import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { ICryptoService } from '../interfaces/ICryptoService';

/**
 * AES-256-CBC 암호화 서비스
 * - ICryptoService 인터페이스 구현체
 * - pgcrypto 등 다른 방식으로 교체 시 이 클래스만 교체
 * - IV는 암호화마다 새로 생성하여 재생 공격(replay attack) 방지
 */
@Injectable()
export class CryptoService implements ICryptoService, OnModuleInit {
  /** AES-256-CBC: 32바이트 키 */
  private readonly key: Buffer;

  /** IV 길이: AES 블록 크기 16바이트 */
  private static readonly IV_LENGTH = 16;

  /** 암호화 알고리즘 */
  private static readonly ALGORITHM = 'aes-256-cbc';

  /** 프로덕션에서 요구하는 최소 키 길이. */
  private static readonly MIN_SECRET_LENGTH = 32;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('CRYPTO_SECRET_KEY', '');
    // scrypt로 임의 길이 비밀키를 32바이트 AES 키로 파생
    this.key = crypto.scryptSync(secret, 'practiveTTS-memory-salt', 32);
  }

  onModuleInit(): void {
    const secret = this.configService.get<string>('CRYPTO_SECRET_KEY', '');
    const isProduction =
      this.configService.get<string>('NODE_ENV', '') === 'production';

    // 미설정이면 secret이 빈 문자열이고, salt는 이 파일에 하드코딩돼 있다.
    // 즉 **저장소를 읽은 누구나 같은 키를 파생**할 수 있고, 가족 실명을
    // 암호화한 값이 사실상 평문이 된다. 경고만 찍고 부팅을 계속하면 그
    // 상태로 운영에 올라가고, 그 뒤에 키를 설정하면 이미 저장된 데이터를
    // 복호화하지 못한다 — 되돌리기가 매우 어렵다.
    //
    // 그래서 프로덕션에서는 부팅을 막는다. 개발에서는 편의를 위해 경고만
    // 남기되, 그 키로 만든 데이터는 보호되지 않는다는 걸 분명히 말한다.
    if (secret.length < CryptoService.MIN_SECRET_LENGTH) {
      const message =
        `CRYPTO_SECRET_KEY가 ${CryptoService.MIN_SECRET_LENGTH}자 미만입니다` +
        `(현재 ${secret.length}자). 이 값은 환자 가족의 실명을 암호화하는 키입니다.`;
      if (isProduction) {
        throw new Error(
          `[CryptoService] ${message} 프로덕션에서는 기동을 중단합니다. ` +
            `생성: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
        );
      }
      console.warn(
        `[CryptoService] ${message} 개발 환경이라 계속 진행하지만, ` +
          '이 키로 암호화된 데이터는 보호되지 않습니다.',
      );
    }
  }

  /**
   * 평문을 AES-256-CBC로 암호화
   * @returns "hex(iv):base64(ciphertext)" 형식
   */
  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(CryptoService.IV_LENGTH);
    const cipher = crypto.createCipheriv(CryptoService.ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);

    return `${iv.toString('hex')}:${encrypted.toString('base64')}`;
  }

  /**
   * "hex(iv):base64(ciphertext)" 형식을 파싱하여 복호화
   */
  decrypt(cipherText: string): string {
    const [ivHex, encryptedBase64] = cipherText.split(':');
    if (!ivHex || !encryptedBase64) {
      throw new Error(
        '잘못된 암호화 형식입니다. iv:ciphertext 형식이어야 합니다.',
      );
    }

    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedBase64, 'base64');

    const decipher = crypto.createDecipheriv(
      CryptoService.ALGORITHM,
      this.key,
      iv,
    );

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
