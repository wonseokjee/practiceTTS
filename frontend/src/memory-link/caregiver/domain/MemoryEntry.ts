// 메모리 엔트리 도메인 타입 정의

/** 목표 단어 최대 개수 */
export const MAX_TARGET_WORDS = 3;

/** 감정 태그 허용 값 타입 */
export type EmotionTag = 'happy' | 'calm' | 'nostalgic' | 'excited';

/** 감정 태그 한국어 레이블 */
export const EMOTION_TAG_LABELS: Record<EmotionTag, string> = {
  happy: '행복한',
  calm: '평온한',
  nostalgic: '그리운',
  excited: '설레는',
};

/** 허용된 감정 태그 목록 */
export const VALID_EMOTION_TAGS: EmotionTag[] = [
  'happy',
  'calm',
  'nostalgic',
  'excited',
];

/**
 * 메모리 엔트리 도메인 타입
 * - maskedContext, scenarioCache는 보안상 응답에 미포함
 * - hasScenario, hasMaskedContext로 존재 여부만 확인
 */
export interface MemoryEntry {
  id: string;
  patientId: string;
  photoUrl: string | null;
  locationTag: string | null;
  objectTags: string[] | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];
  /** scenarioCache 존재 여부 */
  hasScenario: boolean;
  /** maskedContext 존재 여부 */
  hasMaskedContext: boolean;
  /** ISO 8601 형식 문자열 */
  createdAt: string;
}

/** 메모리 엔트리 생성 요청 타입 */
export interface CreateMemoryEntryRequest {
  patientId: string;
  emotionTag?: EmotionTag;
  targetWords?: string[];
  photo: File;
}

/** 메모리 엔트리 수정 요청 타입 (사진 수정 불가) */
export interface UpdateMemoryEntryRequest {
  emotionTag?: EmotionTag;
  targetWords?: string[];
}
