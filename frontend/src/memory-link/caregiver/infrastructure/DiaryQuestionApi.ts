// 일기 질문 풀 조회 API 클라이언트
//
// 백엔드 §7-1 명세:
//   GET /diary-questions/today?scope=caregiver
//   GET /diary-questions/today?scope=patient&category=activity
//   GET /diary-questions/today?scope=patient&category=moment
//   GET /diary-questions/today?scope=patient&category=context
//
// JWT 자동 주입은 memoryLinkApi 인터셉터가 처리한다.

import { memoryLinkApi } from '../../shared/MemoryLinkApi.js';
import type {
  DiaryQuestion,
  DiaryQuestionScope,
  PatientCategory,
} from '../domain/CaptureFlow.js';

/** API 클라이언트 인터페이스 (테스트 시 Mock 교체용) */
export interface IDiaryQuestionApi {
  /** scope=caregiver 또는 scope=patient&category=... 랜덤 1개 */
  fetchToday(args: {
    scope: DiaryQuestionScope;
    category?: PatientCategory;
  }): Promise<DiaryQuestion>;
}

/** 응답 형식 런타임 검증 */
function isDiaryQuestion(value: unknown): value is DiaryQuestion {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string') return false;
  if (obj.scope !== 'caregiver' && obj.scope !== 'patient') return false;
  if (typeof obj.text !== 'string') return false;
  if (
    obj.category !== null &&
    obj.category !== 'activity' &&
    obj.category !== 'moment' &&
    obj.category !== 'context'
  ) {
    return false;
  }
  return true;
}

function toDiaryQuestion(raw: unknown): DiaryQuestion {
  if (!isDiaryQuestion(raw)) {
    throw new Error('일기 질문 응답 형식이 올바르지 않습니다.');
  }
  return raw;
}

export const diaryQuestionApi: IDiaryQuestionApi = {
  async fetchToday({ scope, category }): Promise<DiaryQuestion> {
    const params: Record<string, string> = { scope };
    if (scope === 'patient') {
      if (!category) {
        throw new Error('scope=patient일 때 category는 필수입니다.');
      }
      params.category = category;
    }

    const res = await memoryLinkApi.get<unknown>('/diary-questions/today', {
      params,
    });
    return toDiaryQuestion(res.data);
  },
};
