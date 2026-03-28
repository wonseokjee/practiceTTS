import { memoryLinkApi } from '../../shared/MemoryLinkApi.js';
import type {
  CreateMemoryEntryRequest,
  MemoryEntry,
  UpdateMemoryEntryRequest,
} from '../domain/MemoryEntry.js';

/**
 * 메모리 엔트리 API 클라이언트 인터페이스
 * - 테스트 시 MockMemoryEntryApi로 교체 가능
 */
export interface IMemoryEntryApi {
  create(data: CreateMemoryEntryRequest): Promise<MemoryEntry>;
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
  /** POST /memory-entries (multipart/form-data) */
  async create(data: CreateMemoryEntryRequest): Promise<MemoryEntry> {
    const formData = new FormData();
    formData.append('photo', data.photo);
    formData.append('patientId', data.patientId);

    if (data.emotionTag) {
      formData.append('emotionTag', data.emotionTag);
    }
    if (data.targetWords) {
      data.targetWords.forEach((word) => formData.append('targetWords', word));
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
