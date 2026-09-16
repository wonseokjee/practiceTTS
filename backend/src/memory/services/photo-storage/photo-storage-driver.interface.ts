import type { Readable } from 'stream';

/**
 * 사진 바이트를 물리적으로 저장/조회/삭제하는 구현체가 지켜야 할 계약.
 *
 * FileStorageService가 이 인터페이스 뒤에서 드라이버(local/r2)를 선택한다.
 * 파일명 생성·공개 URL 형식은 드라이버의 책임이 아니다 — FileStorageService가
 * 맡는다(드라이버를 바꿔도 photoUrl 저장 형식·접근 경로가 안 바뀌게).
 */
export interface IPhotoStorageDriver {
  /** filename으로 buffer를 저장한다. 대상 파일이 이미 있으면 덮어쓴다. */
  save(buffer: Buffer, filename: string): Promise<void>;

  /** filename의 내용을 스트림으로 연다. 없으면 throw(호출자가 404로 변환). */
  readStream(filename: string): Promise<Readable>;

  /** filename의 내용을 Base64 문자열로 읽는다. 없으면 throw. */
  readAsBase64(filename: string): Promise<string>;

  /** filename을 삭제한다. 이미 없으면 조용히 통과(idempotent). */
  delete(filename: string): Promise<void>;
}
