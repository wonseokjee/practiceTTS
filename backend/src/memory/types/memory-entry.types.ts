// 메모리 엔트리 공개 타입 정의

/** 감정 태그 허용 값 타입 */
export type EmotionTag = 'happy' | 'calm' | 'nostalgic' | 'excited';

/**
 * FastAPI /tag 엔드포인트 응답 값 객체
 * - locationTag: 장소 태그 (빈 문자열 불가)
 * - objectTags: 사물 태그 목록 (0~10개)
 */
export interface AiTagResult {
  locationTag: string;
  objectTags: string[];
}

/**
 * FastAPI /mask 엔드포인트 응답 값 객체
 * - maskedText: PII 마스킹 완료된 컨텍스트 (빈 문자열 불가)
 * - entity_map은 이 인터페이스에 포함하지 않음 (외부 누설 방지 원칙)
 */
export interface AiMaskResult {
  maskedText: string;
}

/**
 * 시나리오 캐시 내용 값 객체
 * - openingQuestion: 훈련 시작 질문 (목표 단어를 직접 포함하면 안 됨)
 */
export interface ScenarioCacheData {
  openingQuestion: string;
}
