import { describe, expect, it } from 'vitest';
import { alreadyHonorific, withHonorific } from './honorific.js';

/**
 * Regression: ISSUE-006 — 환자 호칭에 경칭을 기계적으로 덧붙여
 * "개발 어르신 어르신"으로 렌더링되던 문제.
 * Found by /qa on 2026-07-19
 * Report: .gstack/qa-reports/qa-report-localhost-2026-07-19.md
 *
 * 가입 폼은 "어르신 성함"을 묻지만 보호자는 부르는 말("어머니", "김영희 여사")을
 * 적는 경우가 많다. 시드 데이터만의 문제가 아니다.
 */
describe('withHonorific', () => {
  it('성함에는 경칭을 붙인다', () => {
    expect(withHonorific('김영희', '어르신')).toBe('김영희 어르신');
    expect(withHonorific('김영희', '님', { separator: '' })).toBe('김영희님');
  });

  // 실제로 보고된 증상
  it('이미 경칭으로 끝나면 겹쳐 붙이지 않는다', () => {
    expect(withHonorific('개발 어르신', '어르신')).toBe('개발 어르신');
    expect(withHonorific('개발 어르신', '님', { separator: '' })).toBe('개발 어르신');
    expect(withHonorific('김영희 여사', '님', { separator: '' })).toBe('김영희 여사');
    expect(withHonorific('박선생님', '어르신')).toBe('박선생님');
  });

  it('그 자체로 호칭인 말에는 붙이지 않는다', () => {
    expect(withHonorific('어머니', '어르신')).toBe('어머니');
    expect(withHonorific('할머니', '님', { separator: '' })).toBe('할머니');
    expect(withHonorific('아버님', '어르신')).toBe('아버님');
  });

  it('이름을 잘라내지 않는다 (보호자가 적은 말을 임의로 손대지 않음)', () => {
    expect(withHonorific('개발 어르신', '어르신')).toContain('개발');
    expect(withHonorific('김영희 여사', '어르신')).toContain('김영희');
  });

  it('앞뒤 공백을 정리한다', () => {
    expect(withHonorific('  김영희  ', '어르신')).toBe('김영희 어르신');
    expect(withHonorific('  개발 어르신 ', '어르신')).toBe('개발 어르신');
  });

  it('이름이 없으면 fallback을 쓴다', () => {
    expect(withHonorific(null, '어르신')).toBe('환자');
    expect(withHonorific(undefined, '어르신')).toBe('환자');
    expect(withHonorific('', '어르신')).toBe('환자');
    expect(withHonorific('   ', '어르신')).toBe('환자');
    expect(withHonorific(null, '어르신', { fallback: '어르신' })).toBe('어르신');
  });
});

describe('alreadyHonorific', () => {
  it('경칭으로 끝나면 true', () => {
    for (const name of ['김영희 어르신', '김영희님', '김영희 씨', '박선생님', '최옹']) {
      expect(alreadyHonorific(name)).toBe(true);
    }
  });

  it('평범한 성함이면 false', () => {
    for (const name of ['김영희', '이순신', '박민준']) {
      expect(alreadyHonorific(name)).toBe(false);
    }
  });

  it('빈 값이면 false', () => {
    expect(alreadyHonorific('')).toBe(false);
    expect(alreadyHonorific('   ')).toBe(false);
  });
});
