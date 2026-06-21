// speechScore.ts — 따라말하기/소리내어읽기 WER 채점 테스트

import { describe, expect, it } from 'vitest';
import { isSpeechCorrect, speechErrorRate } from './speechScore.js';

describe('speechErrorRate', () => {
  it('완전 일치는 오류율 0', () => {
    expect(speechErrorRate('사과', '사과', 'word')).toBe(0);
    expect(speechErrorRate('오늘 날씨가 좋아요', '오늘 날씨가 좋아요', 'sentence')).toBe(0);
  });

  it('단어: 한 음절 차이는 1/길이', () => {
    // "사과"(2음절) 중 1음절 치환 → 0.5
    expect(speechErrorRate('사가', '사과', 'word')).toBeCloseTo(0.5, 5);
  });

  it('문장: 한 어절 차이는 1/어절수', () => {
    // 3어절 중 1어절 치환 → 1/3
    expect(
      speechErrorRate('오늘 날씨가 추워요', '오늘 날씨가 좋아요', 'sentence'),
    ).toBeCloseTo(1 / 3, 5);
  });

  it('구두점/대소문자/공백은 무시', () => {
    expect(speechErrorRate('  오늘   날씨가 좋아요! ', '오늘 날씨가 좋아요', 'sentence')).toBe(0);
  });

  it('목표가 비면 오류율 1(인식 텍스트 있을 때)', () => {
    expect(speechErrorRate('사과', '', 'word')).toBe(1);
  });
});

describe('isSpeechCorrect', () => {
  it('완전 일치는 정답', () => {
    expect(isSpeechCorrect('사과', '사과', 'word')).toBe(true);
  });

  it('긴 문장에서 한 어절 차이는 관대하게 정답', () => {
    // 4어절 중 1어절 차이 = 0.25 ≤ 0.34
    expect(
      isSpeechCorrect('가족이 함께 점심을 먹어요', '가족이 함께 저녁을 먹어요', 'sentence'),
    ).toBe(true);
  });

  it('절반이 틀리면 오답', () => {
    expect(isSpeechCorrect('바나나', '사과', 'word')).toBe(false);
  });

  it('빈 입력은 오답', () => {
    expect(isSpeechCorrect('', '사과', 'word')).toBe(false);
    expect(isSpeechCorrect('   ', '오늘 날씨가 좋아요', 'sentence')).toBe(false);
  });
});
