import { MemoryEntryResponseDto } from './memory-entry-response.dto';

/**
 * 보호자 본인 전용 상세 응답 DTO (Private)
 *
 * - extends MemoryEntryResponseDto (Public) + 보호자 사적 데이터.
 * - **Phase 1에서는 endpoint를 노출하지 않는다.** (P1-N8=(b))
 * - 타입과 매퍼 시그니처만 미리 정의하여 Phase 8+ 무드 추세 화면 도입 시 즉시 사용 가능.
 *
 * 사용 위치 제약 (코드 리뷰 가드):
 *  - LLM 입력 페이로드(`IQuizGenerationPayload`)에 본 DTO를 절대 전달하지 않는다.
 *  - 환자 사이드의 어떠한 응답에도 사용되지 않는다.
 */
export class MemoryEntryPrivateResponseDto extends MemoryEntryResponseDto {
  /** 보호자 본인 무드 (1~5) — Public DTO에는 없음 */
  mood: {
    level: 1 | 2 | 3 | 4 | 5;
    recordedAt: string;
  };

  /** 보호자 사적 답변 ("나의 하루") — Public DTO에는 없음 */
  caregiverReflection: {
    questionId: string;
    answerText: string;
    createdAt: string;
  } | null;
}
