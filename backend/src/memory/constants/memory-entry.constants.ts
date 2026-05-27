// 메모리 엔트리 도메인 상수

/** 목표 단어 최대 개수 */
export const MAX_TARGET_WORDS = 3;

/** 사진 업로드 최대 크기 (5MB) */
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

/** 허용된 이미지 MIME 타입 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** 허용된 감정 태그 값 */
export const VALID_EMOTION_TAGS = [
  'happy',
  'calm',
  'nostalgic',
  'excited',
] as const;
