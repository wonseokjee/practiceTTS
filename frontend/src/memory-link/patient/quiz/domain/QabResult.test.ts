import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stampAnswered, type QabResultInput } from './QabResult';

const BASE: QabResultInput = { subtest: 'word', itemRef: 'qw_001', isCorrect: true };

describe('stampAnswered — 푼 시각(계획 OV-B)', () => {
  it('주어진 시각을 UTC ISO로 찍는다', () => {
    const at = new Date('2026-09-14T10:00:00+09:00');

    expect(stampAnswered(BASE, at).answeredAt).toBe('2026-09-14T01:00:00.000Z');
  });

  it('서버의 시간대 필수 검사를 통과하는 모양이다', () => {
    // 백엔드 DTO의 정규식과 같다. 시간대 없는 문자열은 서버 현지 시각으로 읽혀
    // 서버가 거부한다 — 여기서 모양이 바뀌면 모든 제출이 400이 된다.
    const rfc3339 =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

    expect(stampAnswered(BASE).answeredAt).toMatch(rfc3339);
  });

  it('이미 찍힌 시각은 덮지 않는다 — 재전송이 원래 시각을 지킨다', () => {
    const stamped = stampAnswered(BASE, new Date('2026-09-14T01:00:00Z'));

    const again = stampAnswered(stamped, new Date('2026-09-16T01:00:00Z'));

    expect(again.answeredAt).toBe('2026-09-14T01:00:00.000Z');
  });

  it('원본을 바꾸지 않는다', () => {
    stampAnswered(BASE);

    expect(BASE).not.toHaveProperty('answeredAt');
  });
});

describe('오늘의 세션은 모든 결과에 푼 시각을 찍는다', () => {
  /**
   * `useMixedQuizSession`은 결과를 여섯 곳에서 쌓는다. 하나라도 ref에 직접
   * push하면 그 문항만 시각 없이 가서 서버 시각(도착한 날)으로 저장된다.
   * 화면은 멀쩡하고 테스트도 통과한다 — 그래서 소스를 직접 본다.
   */
  const source = readFileSync(
    join(
      process.cwd(),
      'src/memory-link/patient/quiz/application/useMixedQuizSession.ts',
    ),
    'utf8',
  );

  it('결과 ref에 직접 push하지 않는다', () => {
    expect(source.match(/qabResultsRef\.current\.push\(/g) ?? []).toEqual([]);
  });

  it('여섯 곳이 전부 pushAnswered를 거친다', () => {
    // 개수를 고정한다 — 결과를 쌓는 곳이 늘거나 줄면 여기서 한 번 멈춰
    // 새 자리도 시각을 찍는지 확인하게 한다.
    expect(source.match(/pushAnswered\(qabResultsRef,/g)).toHaveLength(6);
  });
});
