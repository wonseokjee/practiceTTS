import { describe, it, expect } from 'vitest';
import {
  gradeFromErrorRate,
  accuracyScore,
  isGradePass,
  evaluateSpeech,
  evaluateFromAzure,
  type AzurePronunciationScores,
} from './pronunciationScore.js';

describe('gradeFromErrorRate — 5단계 경계', () => {
  it('오류율 0은 완벽(perfect)', () => {
    expect(gradeFromErrorRate(0)).toBe('perfect');
  });
  it('0.15 이하는 아주 좋음(great)', () => {
    expect(gradeFromErrorRate(0.1)).toBe('great');
    expect(gradeFromErrorRate(0.15)).toBe('great');
  });
  it('0.34 이하는 좋음(good, 정답 경계)', () => {
    expect(gradeFromErrorRate(0.2)).toBe('good');
    expect(gradeFromErrorRate(0.34)).toBe('good');
  });
  it('0.5 이하는 근접(close)', () => {
    expect(gradeFromErrorRate(0.4)).toBe('close');
    expect(gradeFromErrorRate(0.5)).toBe('close');
  });
  it('0.5 초과는 재시도(retry)', () => {
    expect(gradeFromErrorRate(0.6)).toBe('retry');
    expect(gradeFromErrorRate(1)).toBe('retry');
  });
});

describe('accuracyScore — 보호자용 0~100', () => {
  it('완전 일치는 100', () => {
    expect(accuracyScore(0)).toBe(100);
  });
  it('오류율 0.2는 80', () => {
    expect(accuracyScore(0.2)).toBe(80);
  });
  it('오류율이 1 이상이면 0으로 하한', () => {
    expect(accuracyScore(1)).toBe(0);
    expect(accuracyScore(1.5)).toBe(0);
  });
});

describe('isGradePass — good 이상만 정답', () => {
  it('perfect·great·good은 정답', () => {
    expect(isGradePass('perfect')).toBe(true);
    expect(isGradePass('great')).toBe(true);
    expect(isGradePass('good')).toBe(true);
  });
  it('close·retry는 오답(재시도)', () => {
    expect(isGradePass('close')).toBe(false);
    expect(isGradePass('retry')).toBe(false);
  });
});

describe('evaluateSpeech — 종합 평가', () => {
  it('완전 일치는 완벽 + 100점 + 정답', () => {
    const r = evaluateSpeech('바다', '바다', 'word');
    expect(r.grade).toBe('perfect');
    expect(r.score).toBe(100);
    expect(r.isCorrect).toBe(true);
    expect(r.encouragement).toContain('완벽');
    expect(r.caregiverLabel).toBe('완벽');
  });

  it('조음 유사 혼동(바다→파다)은 높은 등급 + 정답', () => {
    const r = evaluateSpeech('파다', '바다', 'word');
    expect(r.isCorrect).toBe(true); // 음소 유사로 정답 처리
    expect(r.score).toBeGreaterThanOrEqual(85);
  });

  it('전혀 다른 발화는 재시도 + 낮은 점수 + 격려', () => {
    const r = evaluateSpeech('하수', '바다', 'word');
    expect(r.isCorrect).toBe(false);
    expect(r.encouragement).toContain('다시');
  });

  it('빈 입력은 재시도 + 0점', () => {
    const r = evaluateSpeech('', '바다', 'word');
    expect(r.grade).toBe('retry');
    expect(r.score).toBe(0);
    expect(r.isCorrect).toBe(false);
  });
});

describe('evaluateFromAzure — 음소 단위 채점 정책', () => {
  const scores = (o: Partial<AzurePronunciationScores>): AzurePronunciationScores => ({
    accuracyScore: 0,
    fluencyScore: 0,
    completenessScore: 0,
    pronunciationScore: 0,
    prosodyScore: null,
    ...o,
  });

  it('단어: 정확도가 전부다(완성도 무시)', () => {
    const r = evaluateFromAzure(scores({ accuracyScore: 92, completenessScore: 0 }), '바다', 'word');
    expect(r.grade).toBe('perfect');
    expect(r.score).toBe(92);
    expect(r.isCorrect).toBe(true);
  });

  it('단어: good 경계(60)는 정답 처리', () => {
    const r = evaluateFromAzure(scores({ accuracyScore: 60 }), '바다', 'word');
    expect(r.isCorrect).toBe(true);
    expect(r.grade).toBe('good');
  });

  it('단어: 경계 미만(59)은 오답(close)', () => {
    const r = evaluateFromAzure(scores({ accuracyScore: 59 }), '바다', 'word');
    expect(r.isCorrect).toBe(false);
    expect(r.grade).toBe('close');
  });

  it('문장: 정확도0.6 + 완성도0.4 가중 — 빠뜨림을 반영해 등급이 내려간다', () => {
    // accuracy만 보면 90(great)이지만, 완성도 50이 섞여 round(90*0.6+50*0.4)=74 → good
    const r = evaluateFromAzure(
      scores({ accuracyScore: 90, completenessScore: 50 }),
      '오늘 날씨가 좋아요',
      'sentence',
    );
    expect(r.score).toBe(74);
    expect(r.grade).toBe('good');
    expect(r.isCorrect).toBe(true);
  });

  it('문장: 절반만 말하면(완성도 낮음) 정답 정확도라도 등급이 내려간다', () => {
    // accuracy 100, completeness 20 → round(60+8)=68 → good (아직 정답이지만 great 미만)
    const r = evaluateFromAzure(
      scores({ accuracyScore: 100, completenessScore: 20 }),
      '오늘 날씨가 좋아요',
      'sentence',
    );
    expect(r.score).toBe(68);
    expect(r.grade).toBe('good');
  });

  it('전사가 비면(NoMatch) 전 점수 무시하고 재시도·오답', () => {
    const r = evaluateFromAzure(scores({ accuracyScore: 99 }), '', 'word');
    expect(r.grade).toBe('retry');
    expect(r.score).toBe(0);
    expect(r.isCorrect).toBe(false);
  });
});
