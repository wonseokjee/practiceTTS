// 매일 치유 메시지 API (Phase 6 Pattern 2) — 환자·보호자 공통.
import { memoryLinkApi } from './MemoryLinkApi.js';

export interface HealingMessage {
  id: string;
  text: string;
}

export interface IHealingMessageApi {
  /** GET /healing-messages/today — 오늘의 메시지 1개 */
  fetchToday(): Promise<HealingMessage>;
}

function isHealingMessage(value: unknown): value is HealingMessage {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'string' && typeof obj.text === 'string';
}

export const healingMessageApi: IHealingMessageApi = {
  async fetchToday(): Promise<HealingMessage> {
    const res = await memoryLinkApi.get<unknown>('/healing-messages/today');
    if (!isHealingMessage(res.data)) {
      throw new Error('서버 응답 형식이 올바르지 않습니다.');
    }
    return res.data;
  },
};
