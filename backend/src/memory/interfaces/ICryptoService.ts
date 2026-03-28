/**
 * 암호화 서비스 인터페이스
 * 구현체 교체 시 (Node.js crypto → pgcrypto 등) 이 인터페이스만 구현하면 됨
 */
export interface ICryptoService {
  /**
   * 평문을 AES-256-CBC로 암호화
   * @param plainText 암호화할 원본 텍스트
   * @returns iv:base64(ciphertext) 형식의 암호화된 문자열
   */
  encrypt(plainText: string): string;

  /**
   * 암호화된 문자열을 복호화
   * @param cipherText iv:base64(ciphertext) 형식의 암호화된 문자열
   * @returns 복호화된 원본 텍스트
   */
  decrypt(cipherText: string): string;
}
