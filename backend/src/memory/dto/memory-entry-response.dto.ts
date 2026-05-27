import type { PatientNoteCategory } from '../../quiz/constants/patient-note-category';
import type { MemoryEntry } from '../entities/memory-entry.entity';
import type { PatientMemoryNote } from '../entities/patient-memory-note.entity';
import type { EmotionTag } from '../types/memory-entry.types';

/**
 * 환자 노트 미리보기 (응답 직렬화 전용 값 객체)
 */
export interface PatientNotePreview {
  category: PatientNoteCategory;
  answerText: string;
  orderIndex: number;
}

/**
 * 환자/공개용 메모리 엔트리 응답 DTO (Public)
 * - **보호자 사적 데이터(mood, caregiverReflection) 절대 미포함**
 * - maskedContext, scenarioCache 원문은 절대 포함하지 않음 (hasScenario / hasMaskedContext만)
 * - patientNotes는 환자 화면에서 컨텍스트 카드로 노출 가능
 * - caregiverWishMessage는 Phase 6에서 환자 화면 노출 예정 (Phase 1은 저장만)
 *
 * 본 DTO는 보안 회귀 테스트(memory-entry-response.dto.spec.ts)로 검증된다.
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
  /** Phase 6에서 환자 화면에 노출 예정 (Phase 1은 저장값 또는 null) */
  caregiverWishMessage: string | null;
  /** Step 3 환자 답변 미리보기 (Phase 3 퀴즈 LLM 입력 원천이기도 함) */
  patientNotes: ReadonlyArray<PatientNotePreview>;
  /** ISO 8601 형식 문자열 */
  createdAt: string;
}

/**
 * MemoryEntry + (선택)PatientMemoryNote[] → Public DTO 변환
 *
 * @param entity MemoryEntry 엔티티
 * @param patientNotes 동일 memoryEntryId의 PatientMemoryNote 목록 (없으면 빈 배열)
 */
export function toMemoryEntryResponseDto(
  entity: MemoryEntry,
  patientNotes: ReadonlyArray<PatientMemoryNote> = [],
): MemoryEntryResponseDto {
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
    caregiverWishMessage: entity.caregiverWishMessage ?? null,
    patientNotes: patientNotes
      .map((note) => ({
        category: note.category,
        answerText: note.answerText,
        orderIndex: note.orderIndex,
      }))
      // 응답 순서는 orderIndex 오름차순으로 강제
      .sort((a, b) => a.orderIndex - b.orderIndex),
    createdAt: entity.createdAt.toISOString(),
  };
}
