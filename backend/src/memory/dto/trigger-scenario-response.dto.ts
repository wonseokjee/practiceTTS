/**
 * 시나리오 생성 트리거 응답 DTO
 * - 시나리오 생성은 동기 호출이지만, 클라이언트에는 status만 반환
 */
export class TriggerScenarioResponseDto {
  status: 'triggered';
  memoryEntryId: string;
}
