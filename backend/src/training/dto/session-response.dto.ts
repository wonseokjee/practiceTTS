import type {
  TrainingSession,
  TrainingSessionStatus,
} from '../entities/training-session.entity';

/** 훈련 세션 응답 DTO */
export class SessionResponseDto {
  id: string;
  patientId: string;
  memoryEntryId: string;
  status: TrainingSessionStatus;
  hintLevel: number;
  targetWordUsed: string | null;
  success: boolean | null;
  durationMs: number | null;
  /** ISO 8601 형식 문자열 */
  createdAt: string;
  /**
   * 세션 생성 시 반환하는 AI 첫 질문
   * - createSession 응답에만 포함 (getById에서는 null)
   */
  openingQuestion: string | null;
}

/**
 * TrainingSession 엔티티를 SessionResponseDto로 변환
 * @param entity - TrainingSession 엔티티
 * @param openingQuestion - 세션 생성 직후에만 제공 (이후 조회 시 null)
 */
export function toSessionResponseDto(
  entity: TrainingSession,
  openingQuestion: string | null = null,
): SessionResponseDto {
  return {
    id: entity.id,
    patientId: entity.patientId,
    memoryEntryId: entity.memoryEntryId,
    status: entity.status,
    hintLevel: entity.hintLevel,
    targetWordUsed: entity.targetWordUsed,
    success: entity.success,
    durationMs: entity.durationMs,
    createdAt: entity.createdAt.toISOString(),
    openingQuestion,
  };
}
