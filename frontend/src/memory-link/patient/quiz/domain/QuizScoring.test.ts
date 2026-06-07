// QuizScoring.ts — 점수 표시 순수 함수 경계값 테스트
//
// 검증 포인트 (Plan §11 Phase 5):
//  - 만점/0점/범위 보정(clamp)
//  - 별점 환산(반올림)
//  - 구간별 라벨 (항상 긍정 톤)
//  - 표시용 포맷 문자열
//  - 개선 여부(isImprovement)

import { describe, expect, it } from 'vitest';
import {
  formatScore,
  isImprovement,
  isPerfect,
  scoreLabel,
  scoreToStars,
} from './QuizScoring.js';

describe('QuizScoring', () => {
  describe('isPerfect - 만점 여부', () => {
    it('100점이면 true를 반환해야 한다', () => {
      expect(isPerfect(100)).toBe(true);
    });

    it('99점이면 false를 반환해야 한다 (경계값)', () => {
      expect(isPerfect(99)).toBe(false);
    });

    it('100을 초과해도 보정 후 true여야 한다', () => {
      expect(isPerfect(120)).toBe(true);
    });
  });

  describe('scoreToStars - 별점 환산 (반올림)', () => {
    it('100점이면 5개 별이어야 한다', () => {
      expect(scoreToStars(100)).toBe(5);
    });

    it('80점이면 4개 별이어야 한다', () => {
      expect(scoreToStars(80)).toBe(4);
    });

    it('50점이면 2.5 반올림으로 3개 별이어야 한다', () => {
      expect(scoreToStars(50)).toBe(3);
    });

    it('0점이면 0개 별이어야 한다', () => {
      expect(scoreToStars(0)).toBe(0);
    });

    it('10점이면 0.5 반올림으로 1개 별이어야 한다', () => {
      expect(scoreToStars(10)).toBe(1);
    });

    it('음수는 0점으로 보정되어 0개 별이어야 한다', () => {
      expect(scoreToStars(-20)).toBe(0);
    });
  });

  describe('scoreLabel - 구간별 격려 라벨', () => {
    it('100점이면 "완벽해요!"여야 한다', () => {
      expect(scoreLabel(100)).toBe('완벽해요!');
    });

    it('80점이면 "아주 잘하셨어요!"여야 한다 (경계값)', () => {
      expect(scoreLabel(80)).toBe('아주 잘하셨어요!');
    });

    it('79점이면 "잘하셨어요!"여야 한다 (경계값 미만)', () => {
      expect(scoreLabel(79)).toBe('잘하셨어요!');
    });

    it('60점이면 "잘하셨어요!"여야 한다 (경계값)', () => {
      expect(scoreLabel(60)).toBe('잘하셨어요!');
    });

    it('40점이면 "좋아요, 다시 해볼까요?"여야 한다 (경계값)', () => {
      expect(scoreLabel(40)).toBe('좋아요, 다시 해볼까요?');
    });

    it('39점이면 "괜찮아요, 천천히 해봐요"여야 한다 (최저 구간)', () => {
      expect(scoreLabel(39)).toBe('괜찮아요, 천천히 해봐요');
    });

    it('0점이면 "괜찮아요, 천천히 해봐요"여야 한다', () => {
      expect(scoreLabel(0)).toBe('괜찮아요, 천천히 해봐요');
    });
  });

  describe('formatScore - 표시용 포맷', () => {
    it('정수 점수에 "점"을 붙여야 한다', () => {
      expect(formatScore(80)).toBe('80점');
    });

    it('소수점 점수는 반올림해야 한다', () => {
      expect(formatScore(66.6)).toBe('67점');
    });

    it('100 초과는 100으로 보정해야 한다', () => {
      expect(formatScore(150)).toBe('100점');
    });

    it('NaN은 0점으로 보정해야 한다', () => {
      expect(formatScore(Number.NaN)).toBe('0점');
    });
  });

  describe('isImprovement - 개선 여부', () => {
    it('이전 최고점이 null이면 항상 true여야 한다', () => {
      expect(isImprovement(0, null)).toBe(true);
    });

    it('현재가 이전 최고점보다 크면 true여야 한다', () => {
      expect(isImprovement(90, 80)).toBe(true);
    });

    it('현재가 이전 최고점과 같으면 false여야 한다 (경계값)', () => {
      expect(isImprovement(80, 80)).toBe(false);
    });

    it('현재가 이전 최고점보다 작으면 false여야 한다', () => {
      expect(isImprovement(70, 80)).toBe(false);
    });
  });
});
