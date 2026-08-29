import { describe, expect, it } from 'vitest';
import type { QabImageItem } from '../../quiz/domain/MixedQuiz.js';
import {
  WORD_CHOICE_REF_PREFIX,
  toWordChoiceItem,
} from './practiceWordChoice.js';

const wordItem = (): QabImageItem => ({
  itemId: 'qw_001',
  category: 'word',
  promptText: '사과',
  instruction: '들려주는 낱말의 그림을 골라주세요',
  choices: [
    { choiceId: 'c1', label: '배', imageUrl: '/pear.svg', isCorrect: false },
    { choiceId: 'c2', label: '사과', imageUrl: '/apple.svg', isCorrect: true },
    { choiceId: 'c3', label: '감', imageUrl: '/persimmon.svg', isCorrect: false },
  ],
});

describe('toWordChoiceItem', () => {
  it('정답 낱말의 그림을 자극으로 쓴다', () => {
    const item = toWordChoiceItem(wordItem());

    // 그림고르기는 정답 그림이 여럿 중 하나였다. 뒤집으면 그게 유일한 자극이 된다.
    expect(item?.imageUrl).toBe('/apple.svg');
  });

  it('선택지는 낱말 라벨이 되고 순서는 그대로다', () => {
    const item = toWordChoiceItem(wordItem());

    expect(item?.choices.map((c) => c.label)).toEqual(['배', '사과', '감']);
    expect(item?.choices.find((c) => c.isCorrect)?.label).toBe('사과');
  });

  it('item_ref에 접두사를 붙인다', () => {
    // practice_results UNIQUE가 (patient, session, item_ref, attempt)라
    // item_kind가 키에 없다. 접두사가 없으면 같은 낱말을 두 양식으로 낸
    // 세션에서 두 번째 시도가 ON CONFLICT로 조용히 사라진다.
    const item = toWordChoiceItem(wordItem());

    expect(item?.itemId).toBe(`${WORD_CHOICE_REF_PREFIX}qw_001`);
    expect(item?.itemId).not.toBe('qw_001');
  });

  it('문장 문항은 뒤집지 않는다', () => {
    // 선택지 라벨이 "고양이가 개를 쫓는 장면" 같은 장면 서술이라
    // 낱말로 고를 대상이 아니다.
    const sent: QabImageItem = { ...wordItem(), category: 'sentence' };

    expect(toWordChoiceItem(sent)).toBeNull();
  });

  it('정답이 없는 문항은 만들지 않는다', () => {
    const broken: QabImageItem = {
      ...wordItem(),
      choices: wordItem().choices.map((c) => ({ ...c, isCorrect: false })),
    };

    expect(toWordChoiceItem(broken)).toBeNull();
  });
});
