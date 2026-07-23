import { describe, it, expect } from 'vitest';
import {
  gradeFromErrorRate,
  accuracyScore,
  isGradePass,
  evaluateSpeech,
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
