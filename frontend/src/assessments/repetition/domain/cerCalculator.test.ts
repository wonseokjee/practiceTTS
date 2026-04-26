import { describe, it, expect } from 'vitest';
import { normalizeKoreanText, calculateLevenshteinDistance, calculateScore } from './cerCalculator';

describe('cerCalculator', () => {
  describe('normalizeKoreanText', () => {
    it('removes spaces and punctuation', () => {
      expect(normalizeKoreanText('안녕하세요, 반갑습니다!')).toBe('안녕하세요반갑습니다');
      expect(normalizeKoreanText('사과 배 포도.')).toBe('사과배포도');
    });
    it('keeps alphanumeric and hangul', () => {
      expect(normalizeKoreanText('Hello 안녕 123')).toBe('Hello안녕123');
    });
    it('handles empty or undefined strings', () => {
      expect(normalizeKoreanText('')).toBe('');
      expect(normalizeKoreanText(undefined as any)).toBe('');
    });
  });

  describe('calculateLevenshteinDistance', () => {
    it('calculates correct distance', () => {
      expect(calculateLevenshteinDistance('사과', '사과')).toBe(0);
      expect(calculateLevenshteinDistance('사과', '서과')).toBe(1); // 대치
      expect(calculateLevenshteinDistance('사과', '사')).toBe(1); // 삭제
      expect(calculateLevenshteinDistance('사과', '사과과')).toBe(1); // 삽입
      expect(calculateLevenshteinDistance('안녕하세요', '안녕서세요')).toBe(1);
    });
  });

  describe('calculateScore', () => {
    it('scores 2 points for perfect match (ignoring spaces)', () => {
      const result = calculateScore('학교에 간다', '학교에간다');
      expect(result.score).toBe(2);
      expect(result.cer).toBe(0);
      expect(result.isCorrect).toBe(true);
    });

    it('scores 1 point for minor error (<= 25% CER)', () => {
      const result = calculateScore('할아버지가', '할어버지가'); // 5글자 중 1글자 오류 (CER 0.2)
      expect(result.score).toBe(1);
      expect(result.cer).toBe(0.2);
    });

    it('scores 0 points for major error (> 25% CER)', () => {
      const result = calculateScore('할아버지가', '할아버지는다'); // 5글자 중 2글자 오류 (CER 0.4)
      expect(result.score).toBe(0);
      expect(result.cer).toBe(0.4);
      expect(result.isCorrect).toBe(false);
    });

    it('scores 0 points for completely wrong text', () => {
      const result = calculateScore('안녕하세요', '반갑습니다요');
      expect(result.score).toBe(0);
      expect(result.cer).toBeGreaterThan(0.25);
    });

    it('handles short words appropriately', () => {
      // 2글자 단어에서 1글자 오차는 CER 50%이므로 0점 처리됨
      const result = calculateScore('사과', '상과');
      expect(result.score).toBe(0);
      expect(result.cer).toBe(0.5);
    });

    it('handles empty sttOutput (silence/no detection)', () => {
      const result = calculateScore('안녕하세요', '');
      expect(result.score).toBe(0);
      expect(result.cer).toBe(1); // 5/5
    });

    it('handles empty stimulus gracefully', () => {
      const result = calculateScore('', '아무말');
      expect(result.score).toBe(0);
      expect(result.cer).toBe(1);
    });
  });
});
