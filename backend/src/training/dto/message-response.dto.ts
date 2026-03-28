/** AI 응답 메시지 DTO */
export class MessageResponseDto {
  /** AI 생성 응답 텍스트 */
  aiMessage: string;
  /** 이 응답이 힌트를 포함하는지 여부 */
  hintTriggered: boolean;
  /** 현재 힌트 단계 (0 | 1 | 2) */
  hintLevel: number;
}
