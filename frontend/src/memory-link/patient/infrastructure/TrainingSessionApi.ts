import { memoryLinkApi } from '../../shared/MemoryLinkApi.js';
import type {
  AvailableEntry,
  TrainingSession,
} from '../domain/TrainingSession.js';

/** 메시지 전송 응답 타입 */
export interface SendMessageResponse {
  aiMessage: string;
  hintTriggered: boolean;
  hintLevel: number;
}

/**
 * 훈련 세션 API 클라이언트 인터페이스
 * 테스트 시 MockTrainingSessionApi로 교체 가능
 */
export interface ITrainingSessionApi {
  /** 환자의 훈련 가능 엔트리 목록 조회 */
  getAvailableEntries(): Promise<AvailableEntry[]>;
  /** 훈련 세션 생성 */
  create(memoryEntryId: string, targetWord: string): Promise<TrainingSession>;
  /** 세션 단건 조회 */
  getById(id: string): Promise<TrainingSession>;
  /** 환자 발화 전송 → AI 응답 반환 */
  sendMessage(sessionId: string, transcript: string): Promise<SendMessageResponse>;
  /** 힌트 레벨 증가 */
  incrementHint(sessionId: string): Promise<{ hintLevel: number }>;
  /** 세션 완료 처리 */
  complete(sessionId: string, success: boolean): Promise<TrainingSession>;
}

// ─── 런타임 타입 검증 ──────────────────────────────────────────────────────

function isTrainingSession(value: unknown): value is TrainingSession {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.memoryEntryId === 'string' &&
    typeof obj.status === 'string' &&
    typeof obj.hintLevel === 'number' &&
    typeof obj.createdAt === 'string'
  );
}

function toTrainingSession(raw: unknown): TrainingSession {
  if (!isTrainingSession(raw)) {
    throw new Error('서버 응답 형식이 올바르지 않습니다. (TrainingSession)');
  }
  return raw;
}

function isAvailableEntry(value: unknown): value is AvailableEntry {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.hasScenario === 'boolean' &&
    Array.isArray(obj.targetWords) &&
    typeof obj.createdAt === 'string'
  );
}

function isSendMessageResponse(value: unknown): value is SendMessageResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.aiMessage === 'string' &&
    typeof obj.hintTriggered === 'boolean' &&
    typeof obj.hintLevel === 'number'
  );
}

// ─── 구현체 ────────────────────────────────────────────────────────────────

/**
 * 훈련 세션 API 클라이언트 구현체
 * - JWT 자동 주입은 memoryLinkApi 인터셉터가 처리
 */
export const trainingSessionApi: ITrainingSessionApi = {
  /** GET /training/entries */
  async getAvailableEntries(): Promise<AvailableEntry[]> {
    if (import.meta.env.DEV) {
      // 로컬 프론트엔드 단독 테스트 시 백엔드 네트워크 에러 우회를 위한 가짜 데이터 반환
      return [
        {
          id: 'mock-entry-1',
          hasScenario: true,
          targetWords: ['사과', '바나나'],
          createdAt: new Date().toISOString(),
          photoUrl: 'https://via.placeholder.com/150',
          locationTag: '로컬 거실',
          emotionTag: '즐거움',
        },
      ] as AvailableEntry[];
    }
  
    const res = await memoryLinkApi.get<unknown>('/training/entries');
    const data = res.data;
    if (!Array.isArray(data)) {
      throw new Error('서버 응답 형식이 올바르지 않습니다.');
    }
    return data.filter(isAvailableEntry);
  },

  /** POST /training/sessions */
  async create(memoryEntryId: string, targetWord: string): Promise<TrainingSession> {
    const res = await memoryLinkApi.post<unknown>('/training/sessions', {
      memoryEntryId,
      targetWord,
    });
    return toTrainingSession(res.data);
  },

  /** GET /training/sessions/:id */
  async getById(id: string): Promise<TrainingSession> {
    const res = await memoryLinkApi.get<unknown>(`/training/sessions/${id}`);
    return toTrainingSession(res.data);
  },

  /** POST /training/sessions/:id/message */
  async sendMessage(sessionId: string, transcript: string): Promise<SendMessageResponse> {
    const res = await memoryLinkApi.post<unknown>(
      `/training/sessions/${sessionId}/message`,
      { transcript },
    );
    const data = res.data;
    if (!isSendMessageResponse(data)) {
      throw new Error('서버 응답 형식이 올바르지 않습니다. (SendMessageResponse)');
    }
    return data;
  },

  /** POST /training/sessions/:id/hint */
  async incrementHint(sessionId: string): Promise<{ hintLevel: number }> {
    const res = await memoryLinkApi.post<unknown>(
      `/training/sessions/${sessionId}/hint`,
    );
    const data = res.data;
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>).hintLevel !== 'number'
    ) {
      throw new Error('서버 응답 형식이 올바르지 않습니다. (hintLevel)');
    }
    return { hintLevel: (data as Record<string, unknown>).hintLevel as number };
  },

  /** PATCH /training/sessions/:id/complete */
  async complete(sessionId: string, success: boolean): Promise<TrainingSession> {
    const res = await memoryLinkApi.patch<unknown>(
      `/training/sessions/${sessionId}/complete`,
      { success },
    );
    return toTrainingSession(res.data);
  },
};
