import { describe, it, expect } from 'vitest';
import {
  isGradePass,
  evaluateFromAzure,
  UNSCORED_ENCOURAGEMENT,
  type AzurePronunciationScores,
} from './pronunciationScore.js';

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
    if (!r.scored) throw new Error('채점됐어야 한다');
    expect(r.grade).toBe('perfect');
    expect(r.score).toBe(92);
    expect(r.isCorrect).toBe(true);
  });

  it('단어: good 경계(60)는 정답 처리', () => {
    const r = evaluateFromAzure(scores({ accuracyScore: 60 }), '바다', 'word');
    if (!r.scored) throw new Error('채점됐어야 한다');
    expect(r.isCorrect).toBe(true);
    expect(r.grade).toBe('good');
  });

  it('단어: 경계 미만(59)은 오답(close)', () => {
    const r = evaluateFromAzure(scores({ accuracyScore: 59 }), '바다', 'word');
    if (!r.scored) throw new Error('채점됐어야 한다');
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
    if (!r.scored) throw new Error('채점됐어야 한다');
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
    if (!r.scored) throw new Error('채점됐어야 한다');
    expect(r.score).toBe(68);
    expect(r.grade).toBe('good');
  });

  it('전사가 비면(NoMatch) 0점이 아니라 채점 불가다', () => {
    // Azure NoMatch는 전 점수를 0.0으로 돌려준다. 그 0을 기록하면 "못 쟀다"가
    // "못했다"로 남는다 — 0점은 환자 수행에 대한 주장인데 여기엔 그런 주장이 없다.
    const r = evaluateFromAzure(scores({ accuracyScore: 99 }), '', 'word');
    expect(r.scored).toBe(false);
    expect(r.encouragement).toBe(UNSCORED_ENCOURAGEMENT);
  });

  it('음향 점수가 아예 없으면(azure=null) 채점 불가 — 문자열로 폴백하지 않는다', () => {
    // 이 한 줄이 1단계의 전부다. 예전에는 여기서 문자열 근접도 채점이 끼어들어
    // 같은 발화가 경로에 따라 다른 자로 재졌다(Spearman −0.376, 기준 0.6).
    const r = evaluateFromAzure(null, '바다', 'word');
    expect(r.scored).toBe(false);
    expect(r.encouragement).toBe(UNSCORED_ENCOURAGEMENT);
  });

  it('채점 불가 문구는 잘잘못도 원인도 말하지 않는다(비처벌)', () => {
    // 칭찬(잘하셨어요/완벽)도 지적(아쉬워요)도 아니어야 한다 — 수행에 대해
    // 아무 주장을 하지 않는 것이 "못 쟀다"의 정직한 표현이다.
    for (const claim of ['잘하셨', '완벽', '아쉬', '틀']) {
      expect(UNSCORED_ENCOURAGEMENT).not.toContain(claim);
    }
    // 원인도 말하지 않는다. 환자의 목소리 탓으로 들리면 안 된다.
    expect(UNSCORED_ENCOURAGEMENT).not.toContain('안 들');
    // 다시 해보자고 청하기는 한다 — 그게 유일하게 할 수 있는 말이다.
    expect(UNSCORED_ENCOURAGEMENT).toContain('더 해볼까요');
  });
});
