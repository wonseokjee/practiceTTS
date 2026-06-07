// 보호자 측 퀴즈 자동생성 상태 조회/재시도 API 클라이언트 (S1)
//
// 보호자는 라이프로그 저장 후 퀴즈가 실제로 생성됐는지(ready) 또는 실패했는지(failed)를
// 알아야 한다. 자동 생성은 백엔드에서 fire-and-forget이라, 프론트는 memoryEntryId로
// GET /quiz/sets를 폴링하여 결과를 확인한다.
//
// 환자 모듈(patient/quiz)을 import하지 않도록 보호자 전용 경량 클라이언트로 분리한다.

import { memoryLinkApi } from '../../shared/MemoryLinkApi.js';

/** 퀴즈 세트 생성 상태 (백엔드 QuizGenerationStatus 미러) */
export type QuizGenerationStatus = 'pending' | 'ready' | 'failed';

/** 특정 라이프로그의 최신 QuizSet 생성 상태 */
export interface QuizGenerationState {
  quizSetId: string;
  generationStatus: QuizGenerationStatus;
  /** failed일 때 사용자친화 사유 메시지 (그 외 null) */
  generationError: string | null;
}

export interface IQuizGenerationApi {
  /**
   * GET /quiz/sets?memoryEntryId — 해당 라이프로그의 최신 QuizSet 상태.
   * 아직 리스너가 set을 만들지 않았으면 null.
   */
  fetchLatestByMemoryEntry(
    memoryEntryId: string,
  ): Promise<QuizGenerationState | null>;
  /** POST /quiz/generate/:memoryEntryId — 수동 재생성 트리거 */
  regenerate(memoryEntryId: string, force?: boolean): Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function isGenerationStatus(value: unknown): value is QuizGenerationStatus {
  return value === 'pending' || value === 'ready' || value === 'failed';
}

/** GET /quiz/sets 응답 item 1개를 QuizGenerationState로 변환 (형식 불일치 시 null) */
function toGenerationState(value: unknown): QuizGenerationState | null {
  const obj = asRecord(value);
  if (obj === null) return null;
  if (typeof obj.quizSetId !== 'string') return null;
  if (!isGenerationStatus(obj.generationStatus)) return null;
  const generationError =
    typeof obj.generationError === 'string' ? obj.generationError : null;
  return {
    quizSetId: obj.quizSetId,
    generationStatus: obj.generationStatus,
    generationError,
  };
}

/**
 * 보호자 퀴즈 생성 상태 API 구현체.
 * - JWT 자동 주입은 memoryLinkApi 인터셉터가 처리.
 * - patientId는 서버가 토큰에서 도출하므로 보내지 않는다.
 */
export const quizGenerationApi: IQuizGenerationApi = {
  async fetchLatestByMemoryEntry(
    memoryEntryId: string,
  ): Promise<QuizGenerationState | null> {
    const res = await memoryLinkApi.get<unknown>('/quiz/sets', {
      params: { memoryEntryId, limit: 1 },
    });
    const obj = asRecord(res.data);
    const items = obj?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    // 백엔드는 createdAt DESC 정렬 → 첫 항목이 최신.
    return toGenerationState(items[0]);
  },

  async regenerate(memoryEntryId: string, force = true): Promise<void> {
    await memoryLinkApi.post<unknown>(`/quiz/generate/${memoryEntryId}`, {
      force,
    });
  },
};
