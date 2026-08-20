import { describe, expect, it } from 'vitest';
import type { PracticePlayable } from './Practice.js';
import { itemRefOf, scorePracticeAnswer, tierForKind } from './practiceScoring.js';

const imageChoice = (): PracticePlayable => ({
  kind: 'imageChoice',
  id: 'qw_001',
  item: {
    itemId: 'qw_001',
    category: 'word',
    promptText: '사과',
    instruction: '들으신 것을 골라주세요',
    choices: [
      { choiceId: 'c1', label: '사과', imageUrl: '/a.png', isCorrect: true },
      { choiceId: 'c2', label: '바나나', imageUrl: '/b.png', isCorrect: false },
    ],
  },
});

const spell = (target: string): PracticePlayable => ({
  kind: 'spell',
  id: 'sp_001',
  item: {
    itemId: 'sp_001',
    targetWord: target,
    imageUrl: '/a.png',
    tiles: ['사', '과', '바'],
    instruction: '글자를 눌러 만들어주세요',
  },
});

describe('scorePracticeAnswer', () => {
  it('그림 고르기 — 정답 선택지', () => {
    expect(scorePracticeAnswer(imageChoice(), 'c1')).toBe(true);
  });

  it('그림 고르기 — 오답 선택지', () => {
    expect(scorePracticeAnswer(imageChoice(), 'c2')).toBe(false);
  });

  it('그림 고르기 — 없는 선택지는 오답으로 본다', () => {
    expect(scorePracticeAnswer(imageChoice(), 'nope')).toBe(false);
  });

  it('글자 조합 — 목표와 같으면 정답', () => {
    expect(scorePracticeAnswer(spell('사과'), '사과')).toBe(true);
  });

  it('글자 조합 — 공백은 무시한다', () => {
    expect(scorePracticeAnswer(spell('사과'), ' 사 과 ')).toBe(true);
  });

  it('글자 조합 — 순서가 다르면 오답이다', () => {
    // 타일을 누른 순서가 곧 답이므로 발화 채점처럼 관대하게 볼 여지가 없다.
    expect(scorePracticeAnswer(spell('사과'), '과사')).toBe(false);
  });
});

describe('tierForKind', () => {
  it('터치 문항은 전부 Tier 0 — Azure를 안 부른다', () => {
    for (const kind of [
      'imageChoice',
      'wordChoice',
      'category',
      'oddOneOut',
      'arrange',
      'spell',
    ] as const) {
      expect(tierForKind(kind)).toBe(0);
    }
  });

  it('발화 문항의 기본값은 Tier 1 — 발화시키되 채점하지 않는다', () => {
    for (const kind of ['naming', 'repeat', 'reading'] as const) {
      expect(tierForKind(kind)).toBe(1);
    }
  });
});

describe('itemRefOf', () => {
  it('문항 식별자를 그대로 쓴다', () => {
    expect(itemRefOf(imageChoice())).toBe('qw_001');
    expect(itemRefOf(spell('사과'))).toBe('sp_001');
  });
});
