import { describe, it, expect } from 'vitest';
import { calculateWER, scoreRepetitionResult } from './werCalculator';

describe('werCalculator 점수 계산 로직', () => {
  it('정확히 일치하면 WER는 0이다', () => {
    expect(calculateWER('사과', '사과')).toBe(0);
    expect(calculateWER('엄마가 시장에 가요', '엄마가 시장에 가요')).toBe(0);
  });

  it('기호가 포함되어도 제거하고 계산한다', () => {
    expect(calculateWER('사과.', '사과!')).toBe(0);
    expect(calculateWER('엄마가, 시장에 가요?', '엄마가 시장에 가요')).toBe(0);
    expect(calculateWER('"사과를"', '사과를')).toBe(0);
  });

  it('한 단어를 틀리면 치환(Substitution) 처리되어 점수가 깎인다', () => {
    // "할머니가 시장에 가요" (3단어) -> "아버지가 시장에 가요" : 1개 치환 = 1/3 = 0.3333
    const wer = calculateWER('할머니가 시장에 가요', '아버지가 시장에 가요');
    expect(wer).toBe(0.3333);
  });

  it('단어가 누락되면 삭제(Deletion) 처리된다', () => {
    // "할머니가 시장에 가요" (3단어) -> "할머니가 가요" : 1개 삭제 = 1/3 = 0.3333
    const wer = calculateWER('할머니가 시장에 가요', '할머니가 가요');
    expect(wer).toBe(0.3333);
  });
  
  it('단어가 추가되면 삽입(Insertion) 처리된다', () => {
    // "사과" (1단어) -> "맛있는 사과" : 1개 삽입 = 1/1 = 1
    const wer = calculateWER('사과', '맛있는 사과');
    expect(wer).toBe(1);
  });

  it('WER에 따른 결과 점수가 올바르게 환산되어야 한다 (0, 1, 2점)', () => {
    expect(scoreRepetitionResult(0)).toBe(2);    // 완벽 반복
    expect(scoreRepetitionResult(0.2)).toBe(1);  // 경미한 오류 (<= 0.25)
    expect(scoreRepetitionResult(0.25)).toBe(1); // 0.25까지 허용
    expect(scoreRepetitionResult(0.33)).toBe(0); // 심각한 오류 (> 0.25)
  });
});
