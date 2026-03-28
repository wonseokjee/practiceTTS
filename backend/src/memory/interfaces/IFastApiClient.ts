import type { AiMaskResult, AiTagResult, ScenarioCacheData } from '../types/memory-entry.types';

/**
 * FastAPI AI 서비스 클라이언트 인터페이스
 * 구현체 교체 시 이 인터페이스만 구현하면 서비스 로직 변경 불필요
 */
export interface IFastApiClient {
  /**
   * 이미지 URL로 AI 자동 태깅 수행
   * @param imageUrl 공개 접근 가능한 이미지 URL
   * @returns locationTag, objectTags
   */
  tag(imageUrl: string): Promise<AiTagResult>;

  /**
   * 컨텍스트 텍스트의 PII(개인식별정보) 마스킹 수행
   * @param context 마스킹할 원본 텍스트
   * @returns maskedText (entity_map은 즉시 폐기)
   */
  mask(context: string): Promise<AiMaskResult>;

  /**
   * 마스킹된 컨텍스트로 훈련 시나리오 생성
   * @param maskedContext 마스킹 완료된 컨텍스트 텍스트
   * @param targetWords 훈련 목표 단어 목록
   * @param hintLevel 힌트 수준 (0: 없음, 1: 약함, 2: 강함)
   */
  generateScenario(
    maskedContext: string,
    targetWords: string[],
    hintLevel: 0 | 1 | 2,
  ): Promise<ScenarioCacheData>;
}
