// 문장이해 보기 조립 — E8.
//
// 여기서 지키려는 건 네 가지다. 넷 다 조용히 깨질 수 있는 종류라 테스트로 박는다.
//   1) 레벨이 요구한 만큼 보기가 나온다 (우연수준이 실제로 내려갔나)
//   2) 정답은 정확히 하나다
//   3) 자기 장면의 그림이 무관 오답으로 되돌아오지 않는다 (미러 문항의 함정)
//   4) 무관 오답끼리 같은 장면에서 두 장 나오지 않는다
//
// 4번을 "보기 전부가 서로 다른 장면"으로 적었다가 틀렸다. **자기 두 장은 원래 같은
// 장면이다** — 정답과 역할역전 오답은 한 장면을 역할만 바꿔 찍은 두 컷이고, 그
// 대비가 가역문 이해를 재는 수단이다. 그래서 4지선다의 장면 수는 3이 맞다.

import { describe, expect, it } from 'vitest';
import {
  buildSentChoices,
  sceneOfImage,
  pickSentItems,
} from './QabItemBank';
import { sentChoiceTotalForLevel } from '../domain/difficultyRules';

/** 미러 쌍 — 같은 두 장을 정답만 바꿔 쓴다. 3번 항목의 핵심 사례다. */
const 미러문항 = {
  itemId: 'sentComp_01_m',
  sentence: '소녀가 소년을 쫓고 있어요',
  sentenceAudioUrl: '',
  sentenceType: 'reversible',
  choices: [
    {
      imageUrl: '/assets/images/sentComp/sentComp_01_distractor.png',
      altText: '소녀가 소년을 쫓는 모습',
      isCorrect: true,
    },
    {
      imageUrl: '/assets/images/sentComp/sentComp_01_correct.png',
      altText: '소년이 소녀를 쫓는 모습',
      isCorrect: false,
    },
  ],
};

const 다른장면들 = [
  {
    itemId: 'sentComp_02',
    sentence: 's2',
    sentenceAudioUrl: '',
    sentenceType: 'reversible',
    choices: [
      { imageUrl: '/a/sentComp_02_correct.png', altText: 'a', isCorrect: true },
      { imageUrl: '/a/sentComp_02_distractor.png', altText: 'b', isCorrect: false },
    ],
  },
  {
    itemId: 'sentComp_03',
    sentence: 's3',
    sentenceAudioUrl: '',
    sentenceType: 'reversible',
    choices: [
      { imageUrl: '/a/sentComp_03_correct.png', altText: 'c', isCorrect: true },
      { imageUrl: '/a/sentComp_03_distractor.png', altText: 'd', isCorrect: false },
    ],
  },
];

describe('sceneOfImage', () => {
  it('correct와 distractor가 같은 장면으로 접힌다', () => {
    expect(sceneOfImage('/x/sentComp_01_correct.png')).toBe('sentComp_01');
    expect(sceneOfImage('/x/sentComp_01_distractor.png')).toBe('sentComp_01');
    expect(sceneOfImage('/x/sg_04_correct.png')).toBe('sg_04');
  });
});

describe('buildSentChoices', () => {
  it('어느 레벨에서나 4지선다다', () => {
    // 보기 수는 난이도 축이 아니다 — 통사 복잡도가 그 일을 한다.
    // 여기서는 우연수준을 25%로 고정하는 것만 책임진다.
    for (const level of [1, 2, 3, 4, 5]) {
      const 보기 = buildSentChoices(미러문항, 다른장면들, level, () => 0);
      expect(보기, `레벨 ${level}`).toHaveLength(4);
      expect(sentChoiceTotalForLevel(level)).toBe(4);
    }
  });

  it('정답은 정확히 하나다', () => {
    for (const level of [1, 3, 5]) {
      const 보기 = buildSentChoices(미러문항, 다른장면들, level, () => 0);
      expect(보기.filter((c) => c.isCorrect)).toHaveLength(1);
    }
  });

  it('자기 장면의 그림을 무관 오답으로 되가져오지 않는다', () => {
    // 미러 문항은 sentComp_01의 두 장을 쓴다. 풀에 원본(sentComp_01)이 들어 있어도
    // 그 그림이 세 번째 보기로 돌아오면 같은 그림이 두 번 뜬다.
    const 원본 = {
      ...미러문항,
      itemId: 'sentComp_01',
      choices: [...미러문항.choices].reverse(),
    };
    const 보기 = buildSentChoices(미러문항, [원본, ...다른장면들], 4, () => 0);
    const urls = 보기.map((c) => c.imageUrl);
    expect(new Set(urls).size, `중복: ${urls.join(', ')}`).toBe(urls.length);
  });

  it('무관 오답은 서로 다른 장면에서 온다', () => {
    const 보기 = buildSentChoices(미러문항, 다른장면들, 4, () => 0);
    const 자기장면 = sceneOfImage(미러문항.choices[0].imageUrl);
    const 무관장면 = 보기
      .map((c) => sceneOfImage(c.imageUrl))
      .filter((s) => s !== 자기장면);

    expect(무관장면).toHaveLength(2);
    expect(new Set(무관장면).size).toBe(2);
  });

  it('후보가 모자라면 있는 만큼만 낸다 (문항을 버리지 않는다)', () => {
    const 보기 = buildSentChoices(미러문항, [], 5, () => 0);
    expect(보기).toHaveLength(2);
    expect(보기.filter((c) => c.isCorrect)).toHaveLength(1);
  });
});

describe('실제 뱅크', () => {
  it('문장 문항이 4지선다로 나온다', () => {
    const items = pickSentItems(3, 4);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.choices, it.itemId).toHaveLength(4);
      expect(it.choices.filter((c) => c.isCorrect)).toHaveLength(1);
      // 그림은 한 장도 겹치지 않는다.
      const urls = it.choices.map((c) => c.imageUrl);
      expect(new Set(urls).size, `${it.itemId} 그림 중복`).toBe(urls.length);

      // 장면은 자기 것 하나 + 무관 오답 둘 = 3.
      const 장면들 = it.choices.map((c) => sceneOfImage(c.imageUrl));
      expect(new Set(장면들).size, `${it.itemId} 장면`).toBe(3);
    }
  });

  it('더 이상 어느 레벨에서도 2지선다가 아니다', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      for (const it of pickSentItems(5, level)) {
        expect(it.choices.length, `레벨 ${level} / ${it.itemId}`).toBeGreaterThan(2);
      }
    }
  });
});
