import type {
  AiMaskResult,
  AiTagResult,
  ScenarioCacheData,
} from '../types/memory-entry.types';

/**
 * FastAPI AI 서비스 클라이언트 인터페이스
 * 구현체 교체 시 이 인터페이스만 구현하면 서비스 로직 변경 불필요
 */
export interface IFastApiClient {
  /**
   * Base64 이미지로 AI 자동 태깅 수행
   * @param imageBase64 Base64 인코딩된 이미지 데이터
   * @param memoryEntryId 메모리 엔트리 UUID
   * @returns locationTag, objectTags
   */
  tag(imageBase64: string, memoryEntryId: string): Promise<AiTagResult>;

  /**
   * 컨텍스트 텍스트의 PII(개인식별정보) 마스킹 수행
   * @param rawText 마스킹할 원본 텍스트
   * @param memoryEntryId 메모리 엔트리 UUID
   * @returns maskedText (entity_map은 즉시 폐기)
   */
  /** lang = 메모를 쓴 보호자의 로케일(users.locale). 마스킹 규칙을 고른다 */
  mask(
    rawText: string,
    memoryEntryId: string,
    lang: string,
  ): Promise<AiMaskResult>;

  /**
   * 마스킹된 컨텍스트로 훈련 시나리오 생성
   * @param maskedContext 마스킹 완료된 컨텍스트 텍스트
   * @param targetWords 훈련 목표 단어 목록
   * @param emotionTag 감정 태그 (happy | calm | nostalgic | excited)
   * @param memoryEntryId 메모리 엔트리 UUID
   */
  generateScenario(
    maskedContext: string,
    targetWords: string[],
    emotionTag: string,
    memoryEntryId: string,
  ): Promise<ScenarioCacheData>;
}
