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

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('CRYPTO_SECRET_KEY', '');
    // scrypt로 임의 길이 비밀키를 32바이트 AES 키로 파생
    this.key = crypto.scryptSync(secret, 'practiveTTS-memory-salt', 32);
  }

  onModuleInit(): void {
    // 서버 시작 시 CRYPTO_SECRET_KEY 설정 검증
    const secret = this.configService.get<string>('CRYPTO_SECRET_KEY', '');
    if (secret.length < 32) {
      console.warn(
        '[CryptoService] CRYPTO_SECRET_KEY가 32자 미만입니다. 프로덕션에서는 반드시 32자 이상의 안전한 키를 설정하세요.',
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
