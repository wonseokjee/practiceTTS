// 연습 모드 API 클라이언트
//
// 검사(QuizApi.submitQabResults → POST /quiz/qab-results)와 **경로를 나눈 것이
// 설계다.** 두 클라이언트가 서로 다른 엔드포인트에만 쓰므로, 연습 코드가
// 실수로 검사 지표를 건드릴 경로가 없다.

import { memoryLinkApi } from '../../../shared/MemoryLinkApi.js';
import type {
  PracticeAttemptInput,
  PracticeItemKind,
} from '../domain/Practice.js';

const INVALID_RESPONSE_MESSAGE = '서버 응답 형식이 올바르지 않습니다.';

/** GET /practice/summary — 보호자용. 정답률은 첫 시도만 센다(백엔드 주석). */
export interface PracticeSummary {
  days: number;
  sessions: number;
  items: number;
  firstTry: { judged: number; correct: number; rate: number | null };
  byKind: {
    kind: PracticeItemKind;
    items: number;
    judged: number;
    correct: number;
  }[];
  lastPracticedAt: string | null;
}

export interface IPracticeApi {
  /**
   * POST /practice/results — 문항마다 점진 제출(아직 안 보낸 tail만).
   *
   * `saved`는 **실제로 DB에 들어간 행 수**다. 보낸 개수가 아니다. 재제출·중복
   * flush는 `ON CONFLICT DO NOTHING`으로 걸러지므로 `saved`가 보낸 수보다 작을
   * 수 있고, 전부 중복이면 0이다. **그건 실패가 아니라 이미 저장돼 있다는
   * 뜻이다** — 0을 오류로 읽고 재시도하면 무한히 돈다.
   */
  submitResults(
    sessionToken: string,
    results: PracticeAttemptInput[],
  ): Promise<{ saved: number }>;

  /** GET /practice/summary?days= — 보호자 대시보드의 연습 카드. */
  getSummary(days: number): Promise<PracticeSummary>;
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

  async getSummary(days: number): Promise<PracticeSummary> {
    const res = await memoryLinkApi.get<unknown>('/practice/summary', {
      params: { days },
    });
    const obj = res.data as Partial<PracticeSummary> | null;
    if (
      typeof obj !== 'object' ||
      obj === null ||
      typeof obj.items !== 'number' ||
      typeof obj.sessions !== 'number' ||
      !Array.isArray(obj.byKind) ||
      typeof obj.firstTry !== 'object'
    ) {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return obj as PracticeSummary;
  },
};
