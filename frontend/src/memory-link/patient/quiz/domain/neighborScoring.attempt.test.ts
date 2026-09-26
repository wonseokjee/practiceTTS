import { describe, expect, it } from 'vitest';
import {
  MAX_AMBIGUOUS_RETRIES,
  SCORER_VERSION_NEIGHBOR,
  resolveNamingAttempt,
  type CompetitorInfo,
  type CompetitorScore,
} from './neighborScoring.js';
import { UNSCORED } from './pronunciationScore.js';

// 재시도 정책: 모호면 한 번 더 청하고, 다시 말했는데도 모호하면 채점 불가로 마무리한다.
// 판정 규칙 자체(정답·모호·오답)는 neighborScoring.test.ts가 본다.

const azure = (accuracyScore: number) => ({
  accuracyScore,
  fluencyScore: 0,
  completenessScore: 100,
  pronunciationScore: accuracyScore,
  prosodyScore: null,
});

const rival = (text: string, accuracyScore: number): CompetitorScore => ({
  text,
  source: 'neighbor',
  accuracyScore,
  recognizedText: text,
  status: 'ok',
});

const info = (scores: CompetitorScore[]): CompetitorInfo => ({
  scores,
  sttTranscript: null,
  sttStatus: 'ok',
  skipped: null,
});

const resolve = (
  targetAccuracy: number,
  competitors: CompetitorInfo | null | undefined,
  ambiguousRetries: number,
) =>
  resolveNamingAttempt({
    azure: azure(targetAccuracy),
    transcript: '고래',
    targetWord: '고래',
    competitors,
    ambiguousRetries,
  });

describe('resolveNamingAttempt', () => {
  it('재시도는 문항당 1회다', () => {
    expect(MAX_AMBIGUOUS_RETRIES).toBe(1);
  });

  it('가르면 바로 제출한다 — 정답: 판정과 함께 재시도 횟수(0)를 남긴다', () => {
    const out = resolve(90, info([rival('노래', 50)]), 0);
    expect(out.kind).toBe('submit');
    if (out.kind !== 'submit') return;
    expect(out.scoring.scorerVersion).toBe(SCORER_VERSION_NEIGHBOR);
    expect(out.scoring.ambiguousRetries).toBe(0); // NULL이 아니라 0 — 이웃 비교를 거쳤고 안 시켰다
    expect(out.scoring.unscoredReason).toBeUndefined();
    const a = out.scoring.assessment;
    expect(a && a.scored && a.isCorrect).toBe(true);
  });

  it('오답도 바로 제출한다(경쟁자는 볼 필요가 없다)', () => {
    const out = resolve(40, info([rival('노래', 90)]), 0);
    expect(out.kind).toBe('submit');
    if (out.kind !== 'submit') return;
    const a = out.scoring.assessment;
    expect(a && a.scored && a.isCorrect).toBe(false);
    expect(out.scoring.unscoredReason).toBeUndefined();
  });

  it('처음 모호하면 다시 말해 달라고 청한다 — 제출하지 않는다', () => {
    expect(resolve(80, info([rival('노래', 91)]), 0)).toEqual({ kind: 'retry' });
  });

  it('다시 말했는데도 모호하면 채점 불가(모호)로 마무리한다 — 오답이 아니다', () => {
    const out = resolve(80, info([rival('노래', 91)]), 1);
    expect(out).toEqual({
      kind: 'submit',
      scoring: {
        scorerVersion: SCORER_VERSION_NEIGHBOR,
        assessment: UNSCORED,
        unscoredReason: 'ambiguous',
        ambiguousRetries: 1,
      },
    });
  });

  it('다시 말해서 가려지면 그 결과로 제출하고 재시도 횟수(1)를 남긴다', () => {
    const out = resolve(90, info([rival('노래', 50)]), 1);
    expect(out.kind).toBe('submit');
    if (out.kind !== 'submit') return;
    expect(out.scoring.ambiguousRetries).toBe(1);
    const a = out.scoring.assessment;
    expect(a && a.scored && a.isCorrect).toBe(true);
  });

  it('경쟁자를 못 얻으면 채점 불가(no_score)다 — 재시도를 청하지 않는다', () => {
    // 재시도해도 서버가 안 돌아오면 같은 일이 반복된다. 청하는 것은 "가르지 못한" 경우뿐이다.
    for (const c of [null, undefined]) {
      const out = resolve(90, c, 0);
      expect(out.kind).toBe('submit');
      if (out.kind !== 'submit') return;
      expect(out.scoring.assessment).toEqual(UNSCORED);
      expect(out.scoring.unscoredReason).toBe('no_score');
      expect(out.scoring.ambiguousRetries).toBe(0);
    }
  });

  it('목표 채점을 못 얻어도(서버에 못 닿음) 채점 불가(no_score)다', () => {
    const out = resolveNamingAttempt({
      azure: null,
      transcript: '고래',
      targetWord: '고래',
      competitors: null,
      ambiguousRetries: 0,
    });
    expect(out.kind).toBe('submit');
    if (out.kind !== 'submit') return;
    expect(out.scoring.unscoredReason).toBe('no_score');
  });

  it('인식 호출이 실패했으면 채점 불가(no_score)다', () => {
    const c: CompetitorInfo = { ...info([]), sttStatus: 'error' };
    const out = resolve(90, c, 0);
    expect(out.kind).toBe('submit');
    if (out.kind !== 'submit') return;
    expect(out.scoring.unscoredReason).toBe('no_score');
  });
});
