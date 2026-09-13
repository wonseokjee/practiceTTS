// 독립 검사(LOC·단어이해·문장이해) 결과를 서버에 남긴다.
//
// 배경: 이 검사들은 결과를 localStorage에만 저장했다. 퀴즈 안에 섞여 나오는
// QAB 문항은 서버로 갔는데, 정작 **임상적으로 더 중요한 독립 검사가 브라우저에만**
// 남았다. 그래서:
//   - 브라우저 캐시를 지우면 사라진다. 임상 기록이라 볼 수 없다.
//   - 기기를 바꾸면 이력이 통째로 없어진다.
//   - 보호자가 회복 추이를 볼 수 없다(추이 카드가 이 검사들을 아예 몰랐다).
//
// 저장 경로를 하나로 합쳐 위 셋을 해결한다.

import { quizApi } from '../../../memory-link/patient/quiz/infrastructure/QuizApi.js';
import { enqueue as enqueueQabOutbox } from '../../../memory-link/shared/QabOutbox.js';
import {
  stampAnswered,
  type QabResultInput,
  type QabSubtest,
} from '../../../memory-link/patient/quiz/domain/QabResult.js';

/** 검사 한 회차를 식별하는 토큰. 백엔드가 UUID v4를 요구한다. */
export function createAssessmentSessionToken(): string {
  // crypto.randomUUID는 보안 컨텍스트(https/localhost)에서만 있다.
  // 없으면 검사 결과를 통째로 잃는 것보다 폴백이 낫다.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface AssessmentSubmission {
  sessionToken: string;
  results: QabResultInput[];
}

export interface IAssessmentResultSubmitter {
  submit(submission: AssessmentSubmission): Promise<void>;
}

/**
 * 서버 저장 구현.
 *
 * **실패해도 던지지 않는다.** 이 저장은 부가 기록이고, 검사 자체는 이미
 * 끝났다. 여기서 예외를 올리면 환자가 검사를 마쳤는데 오류 화면을 보게 된다 —
 * 고령 환자에게 그게 훨씬 나쁘다. 로컬 저장은 별도로 이미 되어 있으므로
 * 결과가 즉시 사라지지도 않는다.
 *
 * 대신 실패를 조용히 삼키지는 않는다. 콘솔에 남겨 운영자가 알 수 있게 한다.
 */
export class ServerAssessmentResultSubmitter
  implements IAssessmentResultSubmitter
{
  async submit(submission: AssessmentSubmission): Promise<void> {
    if (submission.results.length === 0) {
      return;
    }
    try {
      // 이 submit()은 검사가 끝난 뒤 1회만 호출된다(FinishXxxAssessmentUseCase 등) —
      // 점진 제출이 아니라 이미 완료된 결과의 일괄 저장이므로 완료 마커를 남긴다.
      await quizApi.submitQabResults(
        submission.sessionToken,
        submission.results,
        undefined,
        true,
      );
    } catch (error) {
      console.error('[assessment] 검사 결과 서버 저장 실패', {
        sessionToken: submission.sessionToken,
        count: submission.results.length,
        error,
      });
      // 이 경로는 검사 종료 후 1회뿐이라 이 훅 안에는 "다음 재시도"가 없다 —
      // 지금까지는 여기서 끝이었다(영영 유실). 재부팅 재시도를 위해 공유
      // 대기열에 남긴다(R7, 계획 2-2A). completed=true는 원래 호출과 같다.
      enqueueQabOutbox(
        submission.sessionToken,
        submission.results,
        undefined,
        true,
      );
    }
  }
}

/**
 * 검사별 결과를 QAB 제출 형식으로 바꾸는 도우미.
 *
 * 이 도우미는 **검사가 끝날 때** 불린다(세 호출처 모두). 그래서 푼 시각은
 * 검사를 마친 시각이다. 한 검사가 몇 분이라 날짜 경계에서 어긋날 일은 거의
 * 없고, 서버 시각을 쓰던 것보다 늘 정직하다 — 제출이 늦게 도착해도 안 밀린다.
 */
export function toQabResults(
  subtest: QabSubtest,
  items: ReadonlyArray<{
    itemRef: string;
    isCorrect: boolean;
    score?: number;
    metric?: number;
  }>,
  finishedAt: Date = new Date(),
): QabResultInput[] {
  return items.map((item) =>
    stampAnswered(
      {
        subtest,
        itemRef: item.itemRef,
        isCorrect: item.isCorrect,
        ...(item.score !== undefined ? { score: item.score } : {}),
        ...(item.metric !== undefined ? { metric: item.metric } : {}),
      },
      finishedAt,
    ),
  );
}
