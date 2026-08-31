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
/** 환자가 답한 기록 한 줄. 백엔드 `PatientNotePreview`와 같은 모양이다. */
export interface PatientNotePreview {
  category: 'moment' | 'activity' | 'context';
  answerText: string;
  orderIndex: number;
}

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
  /**
   * 환자가 답한 기록. 백엔드가 목록·단건 모두에서 항상 내려준다
   * (`toMemoryEntryResponseDto`의 기본값이 빈 배열).
   *
   * 예전에는 이 필드를 타입에 안 적어서 **화면이 있는 줄도 몰랐다.** 목록 카드가
   * 사진 없는 기억에 회색 상자와 📷를 그린 게 그래서다 — 보여줄 게 없어서가
   * 아니라 손에 든 것을 안 쓴 것이다.
   */
  patientNotes: PatientNotePreview[];
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
