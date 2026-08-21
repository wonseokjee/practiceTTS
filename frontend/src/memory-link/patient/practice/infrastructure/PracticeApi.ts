// 연습 모드 API 클라이언트
//
// 검사(QuizApi.submitQabResults → POST /quiz/qab-results)와 **경로를 나눈 것이
// 설계다.** 두 클라이언트가 서로 다른 엔드포인트에만 쓰므로, 연습 코드가
// 실수로 검사 지표를 건드릴 경로가 없다.

import { memoryLinkApi } from '../../../shared/MemoryLinkApi.js';
import type { PracticeAttemptInput } from '../domain/Practice.js';

const INVALID_RESPONSE_MESSAGE = '서버 응답 형식이 올바르지 않습니다.';

export interface IPracticeApi {
  /** POST /practice/results — 문항마다 점진 제출(아직 안 보낸 tail만). */
  submitResults(
    sessionToken: string,
    results: PracticeAttemptInput[],
  ): Promise<{ saved: number }>;
}

export const practiceApi: IPracticeApi = {
  async submitResults(
    sessionToken: string,
    results: PracticeAttemptInput[],
  ): Promise<{ saved: number }> {
    const res = await memoryLinkApi.post<unknown>('/practice/results', {
      sessionToken,
      results,
    });
    const obj: unknown = res.data;
    if (
      typeof obj !== 'object' ||
      obj === null ||
      typeof (obj as { saved?: unknown }).saved !== 'number'
    ) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return { saved: (obj as { saved: number }).saved };
  },
};
