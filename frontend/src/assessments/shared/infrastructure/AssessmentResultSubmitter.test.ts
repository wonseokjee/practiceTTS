import { describe, expect, it, vi } from 'vitest';
import {
  ServerAssessmentResultSubmitter,
  createAssessmentSessionToken,
  toQabResults,
} from './AssessmentResultSubmitter.js';
import { quizApi } from '../../../memory-link/patient/quiz/infrastructure/QuizApi.js';

/**
 * 검사 결과 서버 저장 회귀 테스트.
 *
 * 배경: 독립 검사(LOC·단어이해·문장이해)는 결과를 localStorage에만 남겼다.
 * 브라우저 캐시를 지우면 사라지고, 기기를 바꾸면 이력이 없어지고, 보호자가
 * 회복 추이를 볼 수 없었다. 임상 기록으로 쓸 수 없는 상태였다.
 */
describe('ServerAssessmentResultSubmitter', () => {
  it('서버에 결과를 보낸다', async () => {
    const spy = vi
      .spyOn(quizApi, 'submitQabResults')
      .mockResolvedValue({ saved: 3 });

    await new ServerAssessmentResultSubmitter().submit({
      sessionToken: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      results: [
        { subtest: 'loc', itemRef: 'trial-1', isCorrect: true, score: 3 },
      ],
    });

    expect(spy).toHaveBeenCalledWith(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      expect.arrayContaining([expect.objectContaining({ subtest: 'loc' })]),
      undefined,
      true, // 검사 종료 후 1회 저장이므로 완료 마커를 남긴다
    );
    spy.mockRestore();
  });

  it('저장에 실패해도 예외를 올리지 않는다', async () => {
    // 검사는 이미 끝났다. 여기서 던지면 환자가 검사를 마친 뒤 오류 화면을
    // 본다 — 고령 환자에게 그게 훨씬 나쁘고, 로컬 저장은 이미 되어 있다.
    const spy = vi
      .spyOn(quizApi, 'submitQabResults')
      .mockRejectedValue(new Error('network'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      new ServerAssessmentResultSubmitter().submit({
        sessionToken: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        results: [
          { subtest: 'loc', itemRef: 'trial-1', isCorrect: true, score: 3 },
        ],
      }),
    ).resolves.toBeUndefined();

    // 조용히 삼키지는 않는다 — 운영자가 알 수 있어야 한다.
    expect(errorLog).toHaveBeenCalled();
    spy.mockRestore();
    errorLog.mockRestore();
  });

  it('저장 실패는 공유 대기열에 남는다(R7) — 예전엔 콘솔 로그로 끝, 영영 유실이었다', async () => {
    localStorage.clear();
    const spy = vi
      .spyOn(quizApi, 'submitQabResults')
      .mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await new ServerAssessmentResultSubmitter().submit({
      sessionToken: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      results: [
        { subtest: 'loc', itemRef: 'trial-1', isCorrect: true, score: 3 },
      ],
    });

    const stored = JSON.parse(
      localStorage.getItem('ml_qab_outbox') ?? '[]',
    ) as { sessionToken: string; completed?: boolean }[];
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionToken).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    // 이 제출은 항상 1회성 완료 마커를 싣는다 — 대기열에 남긴 것도 같아야 한다.
    expect(stored[0].completed).toBe(true);
    spy.mockRestore();
    vi.restoreAllMocks();
  });

  it('결과가 없으면 요청하지 않는다', async () => {
    const spy = vi.spyOn(quizApi, 'submitQabResults');

    await new ServerAssessmentResultSubmitter().submit({
      sessionToken: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      results: [],
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('createAssessmentSessionToken', () => {
  it('백엔드가 요구하는 UUID v4 형식을 만든다', () => {
    // 형식이 어긋나면 400으로 거부되고 검사 결과가 통째로 유실된다.
    const token = createAssessmentSessionToken();

    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('crypto.randomUUID가 없어도 유효한 토큰을 만든다', () => {
    // 보안 컨텍스트가 아니면 randomUUID가 없다. 그때 검사 결과를 통째로
    // 잃는 것보다 폴백이 낫다.
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', {});

    const token = createAssessmentSessionToken();

    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    vi.stubGlobal('crypto', original);
  });
});

describe('toQabResults', () => {
  const FINISHED = new Date('2026-09-14T01:23:45.000Z');

  it('선택 필드는 값이 있을 때만 넣는다', () => {
    // undefined를 그대로 실어 보내면 백엔드 검증이 거부할 수 있다.
    const results = toQabResults(
      'loc',
      [
        { itemRef: 'trial-1', isCorrect: true, score: 3 },
        { itemRef: 'trial-2', isCorrect: false },
      ],
      FINISHED,
    );

    expect(results[0]).toEqual({
      subtest: 'loc',
      itemRef: 'trial-1',
      isCorrect: true,
      score: 3,
      answeredAt: FINISHED.toISOString(),
    });
    expect(results[1]).toEqual({
      subtest: 'loc',
      itemRef: 'trial-2',
      isCorrect: false,
      answeredAt: FINISHED.toISOString(),
    });
    expect('score' in results[1]).toBe(false);
  });

  it('푼 시각은 검사를 마친 시각이다 — 보내는 시각이 아니다', () => {
    // 제출이 실패하거나 늦게 도착해도 검사한 날로 센다(계획 OV-B).
    const results = toQabResults(
      'word',
      [
        { itemRef: 'w-1', isCorrect: true },
        { itemRef: 'w-2', isCorrect: true },
      ],
      FINISHED,
    );

    expect(results.map((r) => r.answeredAt)).toEqual([
      '2026-09-14T01:23:45.000Z',
      '2026-09-14T01:23:45.000Z',
    ]);
  });

  it('종료 시각을 안 넘기면 지금이다', () => {
    const before = Date.now();
    const [row] = toQabResults('word', [{ itemRef: 'w-1', isCorrect: true }]);
    const at = Date.parse(row.answeredAt ?? '');

    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
