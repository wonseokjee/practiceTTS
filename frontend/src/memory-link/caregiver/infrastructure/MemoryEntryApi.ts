import { memoryLinkApi } from '../../shared/MemoryLinkApi.js';
import type { CreateMemoryEntryRequest3Step } from '../domain/CaptureFlow.js';
import type {
  MemoryEntry,
  UpdateMemoryEntryRequest,
} from '../domain/MemoryEntry.js';

/**
 * 메모리 엔트리 API 클라이언트 인터페이스
 * - 테스트 시 MockMemoryEntryApi로 교체 가능
 *
 * Phase 4부터 `create()`는 3-step 페이로드를 받는다.
 * (Implementation Plan §7-1, Phase 1 Feature Plan §6)
 */
export interface IMemoryEntryApi {
  /** POST /memory-entries — 3-step 캡처 결과 multipart 업로드 */
  create(data: CreateMemoryEntryRequest3Step): Promise<MemoryEntry>;
  getAll(): Promise<MemoryEntry[]>;
  getById(id: string): Promise<MemoryEntry>;
  update(id: string, data: UpdateMemoryEntryRequest): Promise<MemoryEntry>;
  triggerScenario(id: string): Promise<{ status: string; memoryEntryId: string }>;
}

/** 런타임 타입 검증: MemoryEntry 응답 형식 확인 */
function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.patientId === 'string' &&
    typeof obj.hasScenario === 'boolean' &&
    typeof obj.hasMaskedContext === 'boolean' &&
    typeof obj.createdAt === 'string' &&
    Array.isArray(obj.targetWords)
  );
}

/** API 응답을 MemoryEntry 타입으로 안전하게 변환 */
function toMemoryEntry(raw: unknown): MemoryEntry {
  if (!isMemoryEntry(raw)) {
    throw new Error('서버 응답 형식이 올바르지 않습니다.');
  }
  return raw;
}

/**
 * 메모리 엔트리 API 클라이언트 구현체
 * - JWT 자동 주입은 memoryLinkApi 인터셉터가 처리
 */
export const memoryEntryApi: IMemoryEntryApi = {
  /**
   * POST /memory-entries (multipart/form-data) — 3-step 페이로드
   *
   * 백엔드 §7-1 body fields:
   *  - patientId: string (필수)
   *  - mood: JSON string `{ "level": 1..5 }` (필수)
   *  - patientAnswers: JSON string array (필수, 1개 이상 — DTO 레벨은 0 허용 + 서비스 OR 검증)
   *  - caregiverAnswer?: JSON string `{ questionId, answerText }` (선택)
   *  - caregiverWishMessage?: string (선택, Phase 4에선 UI 노출 X)
   *  - photo?: File (선택)
   */
  async create(data: CreateMemoryEntryRequest3Step): Promise<MemoryEntry> {
    const formData = new FormData();
    formData.append('patientId', data.patientId);
    formData.append('mood', JSON.stringify(data.mood));
    formData.append('patientAnswers', JSON.stringify(data.patientAnswers));

    if (data.caregiverAnswer) {
      formData.append(
        'caregiverAnswer',
        JSON.stringify(data.caregiverAnswer),
      );
    }
    if (
      typeof data.caregiverWishMessage === 'string' &&
      data.caregiverWishMessage.length > 0
    ) {
      formData.append('caregiverWishMessage', data.caregiverWishMessage);
    }
    if (data.photo) {
      formData.append('photo', data.photo);
    }

    const res = await memoryLinkApi.post<unknown>('/memory-entries', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return toMemoryEntry(res.data);
  },

  /** GET /memory-entries */
  async getAll(): Promise<MemoryEntry[]> {
    const res = await memoryLinkApi.get<unknown>('/memory-entries');
    const data = res.data;
    if (!Array.isArray(data)) {
      throw new Error('서버 응답 형식이 올바르지 않습니다.');
    }
    return data.map(toMemoryEntry);
  },

  /** GET /memory-entries/:id */
  async getById(id: string): Promise<MemoryEntry> {
    const res = await memoryLinkApi.get<unknown>(`/memory-entries/${id}`);
    return toMemoryEntry(res.data);
  },

  /** PATCH /memory-entries/:id */
  async update(id: string, data: UpdateMemoryEntryRequest): Promise<MemoryEntry> {
    const res = await memoryLinkApi.patch<unknown>(`/memory-entries/${id}`, data);
    return toMemoryEntry(res.data);
  },

  /** POST /memory-entries/:id/scenario */
  async triggerScenario(id: string): Promise<{ status: string; memoryEntryId: string }> {
    const res = await memoryLinkApi.post<unknown>(
      `/memory-entries/${id}/scenario`,
    );
    const data = res.data;
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>).status !== 'string' ||
      typeof (data as Record<string, unknown>).memoryEntryId !== 'string'
    ) {
      throw new Error('서버 응답 형식이 올바르지 않습니다.');
    }
    return data as { status: string; memoryEntryId: string };
  },
};
