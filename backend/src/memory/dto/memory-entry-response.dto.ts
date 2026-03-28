import type { EmotionTag } from '../types/memory-entry.types';
import type { MemoryEntry } from '../entities/memory-entry.entity';

/**
 * 메모리 엔트리 응답 DTO
 * - maskedContext, scenarioCache 원문은 절대 포함하지 않음 (보안 원칙)
 * - hasScenario, hasMaskedContext는 존재 여부만 반환
 */
export class MemoryEntryResponseDto {
  id: string;
  patientId: string;
  photoUrl: string | null;
  locationTag: string | null;
  objectTags: string[] | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];
  /** scenarioCache 존재 여부 (내용 미포함) */
  hasScenario: boolean;
  /** maskedContext 존재 여부 */
  hasMaskedContext: boolean;
  /** ISO 8601 형식 문자열 */
  createdAt: string;
}

/**
 * MemoryEntry 엔티티를 MemoryEntryResponseDto로 변환
 * - 서비스 레이어에서 사용
 */
export function toMemoryEntryResponseDto(entity: MemoryEntry): MemoryEntryResponseDto {
  return {
    id: entity.id,
    patientId: entity.patientId,
    photoUrl: entity.photoUrl ?? null,
    locationTag: entity.locationTag ?? null,
    objectTags: entity.objectTags ?? null,
    emotionTag: (entity.emotionTag as EmotionTag | undefined) ?? null,
    targetWords: entity.targetWords ?? [],
    hasScenario: entity.scenarioCache != null,
    hasMaskedContext: entity.maskedContext != null,
    createdAt: entity.createdAt.toISOString(),
  };
}
