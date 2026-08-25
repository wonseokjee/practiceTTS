import { isAbsolute, join, resolve } from 'path';

/** 업로드 디렉토리 기본값 (백엔드 프로세스 cwd 기준 상대 경로). */
export const DEFAULT_UPLOAD_DIR = 'tts-cache/memory-images';

/**
 * 메모리 사진 업로드 디렉토리를 절대 경로로 해석한다.
 *
 * 저장(multer)·읽기(FileStorageService)·정적 서빙(main.ts)이 각자 경로를
 * 계산하면 한 곳만 어긋나도 사진이 전부 404가 된다. 실제로 저장은
 * `<cwd>/tts-cache/memory-images`, 서빙은 `<cwd>/../tts-cache/memory-images`로
 * 한 단계 어긋나 있어 업로드된 사진이 하나도 표시되지 않았다.
 * 세 경로가 갈라지지 않도록 해석을 이 함수 하나로 모은다.
 *
 * UPLOAD_DIR이 절대 경로면 그대로, 상대 경로면 cwd 기준으로 해석한다.
 */
export function resolveUploadDir(uploadDir?: string): string {
  const configured =
    uploadDir ?? process.env['UPLOAD_DIR'] ?? DEFAULT_UPLOAD_DIR;
  return isAbsolute(configured)
    ? configured
    : resolve(join(process.cwd(), configured));
}
