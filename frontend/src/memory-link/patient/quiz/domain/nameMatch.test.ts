// nameMatch.ts — 그림 이름대기 관대한 채점 테스트

import { describe, expect, it } from 'vitest';
import { isNameMatch } from './nameMatch.js';

describe('isNameMatch', () => {
  it('완전 일치는 정답', () => {
    expect(isNameMatch('사과', '사과')).toBe(true);
  });

  it('조사/어미가 붙어도 정답 이름을 포함하면 정답', () => {
    expect(isNameMatch('사과요', '사과')).toBe(true);
    expect(isNameMatch('사과입니다', '사과')).toBe(true);
  });

  it('앞뒤 공백/대소문자는 무시', () => {
    expect(isNameMatch('  사과 ', '사과')).toBe(true);
    expect(isNameMatch('apple', 'Apple')).toBe(true);
  });

  it('정답이 인식 텍스트를 포함해도(부분 발화) 정답', () => {
    expect(isNameMatch('비행', '비행기')).toBe(true);
  });

  it('전혀 다른 단어는 오답', () => {
    expect(isNameMatch('바나나', '사과')).toBe(false);
  });

  it('빈 입력은 오답', () => {
    expect(isNameMatch('', '사과')).toBe(false);
    expect(isNameMatch('   ', '사과')).toBe(false);
  });
});
