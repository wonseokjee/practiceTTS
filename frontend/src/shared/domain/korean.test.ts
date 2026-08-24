import { describe, expect, it } from 'vitest';
import { copulaSuffix, sharesOnsetOrNucleus, hasFinalConsonant } from './korean.js';

/**
 * 실제로 깨졌던 문구에서 출발한다.
 *
 * 연습 화면이 "이건 '칫솔'예요."를 읽어줬다(2026-08-21, 브라우저 확인).
 * 낱말 뒤에 조사를 그냥 이어붙인 탓이다.
 */
describe('hasFinalConsonant', () => {
  it('받침 있는 글자를 가려낸다', () => {
    expect(hasFinalConsonant('칫솔')).toBe(true); // ㄹ
    expect(hasFinalConsonant('공책')).toBe(true); // ㄱ
    expect(hasFinalConsonant('장면')).toBe(true); // ㄴ
  });

  it('받침 없는 글자를 가려낸다', () => {
    expect(hasFinalConsonant('사과')).toBe(false);
    expect(hasFinalConsonant('거북이')).toBe(false);
    expect(hasFinalConsonant('주전자')).toBe(false);
  });

  it('한글이 아니면 모른다고 한다', () => {
    // null은 "받침이 없다"가 아니라 "판단할 수 없다"는 뜻이다.
    expect(hasFinalConsonant('')).toBeNull();
    expect(hasFinalConsonant('apple')).toBeNull();
    expect(hasFinalConsonant('3')).toBeNull();
    expect(hasFinalConsonant('사과!')).toBeNull();
  });

  it('끝의 공백은 무시한다', () => {
    expect(hasFinalConsonant('칫솔 ')).toBe(true);
    expect(hasFinalConsonant('사과\n')).toBe(false);
  });
});

describe('copulaSuffix', () => {
  it('받침이 있으면 이에요', () => {
    expect(`'칫솔'${copulaSuffix('칫솔')}`).toBe("'칫솔'이에요");
    expect(`'공책'${copulaSuffix('공책')}`).toBe("'공책'이에요");
  });

  it('받침이 없으면 예요', () => {
    expect(`'사과'${copulaSuffix('사과')}`).toBe("'사과'예요");
    expect(`'거북이'${copulaSuffix('거북이')}`).toBe("'거북이'예요");
  });

  it('문장 라벨도 마지막 글자로 정한다', () => {
    const label = '남자가 여자에게 꽃다발을 주는 장면';
    expect(copulaSuffix(label)).toBe('이에요');
  });

  it('한글이 아니면 예요로 둔다', () => {
    expect(copulaSuffix('apple')).toBe('예요');
    expect(copulaSuffix('')).toBe('예요');
  });
});

describe('sharesOnsetOrNucleus', () => {
  it('초성이 같으면 닮았다', () => {
    // 바 · 보 — 초성 ㅂ 공유, 중성은 다르다.
    expect(sharesOnsetOrNucleus('바', '보')).toBe(true);
  });

  it('중성이 같으면 닮았다', () => {
    // 바 · 사 — 중성 ㅏ 공유, 초성은 다르다.
    expect(sharesOnsetOrNucleus('바', '사')).toBe(true);
  });

  it('초성도 중성도 다르면 안 닮았다', () => {
    expect(sharesOnsetOrNucleus('바', '초')).toBe(false);
  });

  it('종성은 보지 않는다', () => {
    // 바 · 밤 — 받침만 다르다. 받침까지 맞추라고 하면 방해 타일 풀에서 후보가
    // 거의 안 남아, 부족분을 무작위로 채우다 레벨이 도로 내려간다.
    expect(sharesOnsetOrNucleus('바', '밤')).toBe(true);
    expect(sharesOnsetOrNucleus('강', '가')).toBe(true);
  });

  it('한글이 아니면 안 닮은 것으로 본다', () => {
    // 모를 때 난도를 올리지 않는다.
    expect(sharesOnsetOrNucleus('a', '바')).toBe(false);
    expect(sharesOnsetOrNucleus('바', '')).toBe(false);
    expect(sharesOnsetOrNucleus('1', '2')).toBe(false);
  });
});
