// QabItemBank.ts — QAB 질문형(단어/문장) 뱅크 테스트

import { describe, expect, it } from 'vitest';
import sentCompRaw from '../../../../assets/data/sentCompItems.json';
import sentMirrorRaw from '../../../../assets/data/qabSentMirror.json';
import sentGeneratedRaw from '../../../../assets/data/qabSentGenerated.json';
import namingOnlyWords from '../../../../assets/data/namingOnlyWords.json';
import namingPhotos from '../../../../assets/data/namingPhotos.json';
import {
  WORD_CATEGORY,
  sentTypeForLevel,
  asItemRef,
  LEVEL_CHOICE_SPEC,
  buildControlledChoices,
  masterWords,
  asWordLabel,
  buildSpellTiles,
  distractorCountForLevel,
  pickNamingItems,
  pickQabItems,
  pickSentItems,
  pickSpellItems,
  pickWordItems,
  qabItemCount,
} from './QabItemBank.js';
import {
  sharesInitialConsonant,
  sharesOnsetOrNucleus,
} from '../../../../shared/domain/korean.js';

/** 선택지 imageUrl("/…/apple.svg")에서 slug를 뽑는다. */
function slugOf(url: string): string {
  return url.split('/').pop()!.replace(/\.[^.]+$/, '');
}

describe('QabItemBank', () => {
  it('pickQabItems: 요청 개수만큼(한도 내) 반환한다', () => {
    expect(pickQabItems(5)).toHaveLength(5);
  });

  it('pickQabItems: 뱅크보다 많이 요청하면 전체만 반환한다', () => {
    expect(pickQabItems(qabItemCount() + 100)).toHaveLength(qabItemCount());
  });

  it('pickQabItems: word/sentence가 섞여 나온다(충분히 뽑으면 두 종류 모두 등장)', () => {
    const cats = new Set(pickQabItems(qabItemCount()).map((i) => i.category));
    expect(cats.has('word')).toBe(true);
    expect(cats.has('sentence')).toBe(true);
  });

  it('각 문항은 정답 선택지를 정확히 1개 가진다(isCorrect 보존)', () => {
    for (const item of pickQabItems(8)) {
      const correct = item.choices.filter((c) => c.isCorrect);
      expect(correct).toHaveLength(1);
      expect(item.promptText.length).toBeGreaterThan(0);
      expect(item.instruction.length).toBeGreaterThan(0);
      expect(item.choices.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('pickWordItems는 word, pickSentItems는 sentence만 반환한다', () => {
    expect(pickWordItems(3).every((i) => i.category === 'word')).toBe(true);
    expect(pickSentItems(3).every((i) => i.category === 'sentence')).toBe(true);
  });

  it('단어이해: 보기 수가 레벨이 약속한 값이고 모두 서로 다르다', () => {
    // 예전엔 레벨을 안 주고 "4보기"를 단언했다. 그건 그림선택만 기본값 3을 쓰던
    // 시절의 값이라, 기본값을 콜드스타트(2)로 맞추자 명세가 아니라 잔재였음이
    // 드러났다. 이제 레벨마다 약속한 수를 표에서 읽어 확인한다.
    for (const lv of [1, 2, 3, 4, 5]) {
      const total = LEVEL_CHOICE_SPEC[lv].total;
      for (const item of pickWordItems(20, lv)) {
        expect(item.choices, `lv${lv}`).toHaveLength(total);
        expect(new Set(item.choices.map((c) => c.imageUrl)).size).toBe(total);
        expect(new Set(item.choices.map((c) => c.label)).size).toBe(total);
        expect(item.choices.filter((c) => c.isCorrect)).toHaveLength(1);
      }
    }
  });

  it('단어이해: 큰 범주(동물/음식/사물) 정답은 같은 범주 유인지를 최소 2개 포함한다', () => {
    // 통제된 유인지: 범주만 알고는 못 맞추도록 같은 범주 오답을 우선 배치한다.
    // 레벨 3을 명시한다 — 의미 오답 2개는 레벨 3부터의 약속이고, 레벨 2(콜드
    // 스타트)는 1개다. 레벨을 안 주면 무엇을 재는 테스트인지 알 수 없다.
    // 'object'는 더 이상 범주가 아니다(E10) — 그 아홉은 범주가 null이다.
    const big = new Set(['animal', 'food']);
    for (const item of pickWordItems(60, 3)) {
      const correct = item.choices.find((c) => c.isCorrect)!;
      const cat = WORD_CATEGORY[slugOf(correct.imageUrl)] ?? 'object';
      if (!big.has(cat)) continue;
      const sameCatDistractors = item.choices.filter(
        (c) => !c.isCorrect && (WORD_CATEGORY[slugOf(c.imageUrl)] ?? 'object') === cat,
      );
      expect(sameCatDistractors.length).toBeGreaterThanOrEqual(
        LEVEL_CHOICE_SPEC[3].sameCat,
      );
    }
  });

  it('0개 요청 시 빈 배열', () => {
    expect(pickQabItems(0)).toEqual([]);
  });

  it('pickNamingItems: 요청 개수만큼, 그림 URL과 정답 이름을 가진다', () => {
    const items = pickNamingItems(3);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.itemId.startsWith('naming_')).toBe(true);
      expect(item.imageUrl.length).toBeGreaterThan(0);
      expect(item.targetWord.length).toBeGreaterThan(0);
      expect(item.instruction.length).toBeGreaterThan(0);
    }
  });

  it('pickNamingItems: 사진이 준비된 단어는 실물 사진을 쓴다', () => {
    // 고령·치매 환자는 선화보다 실물 사진에 더 잘 반응한다(산출 과제).
    // namingPhotos.json에 등록된 단어는 /naming/<slug>.png를 써야 한다.
    // 전체를 뽑아 사과가 반드시 포함되게 한다(무작위 추출이라 일부만 뽑으면 빠질 수 있다).
    const items = pickNamingItems(100);
    const apple = items.find((i) => i.targetWord === '사과');

    // 사과 사진이 등록돼 있으므로 png 경로여야 한다.
    expect(apple?.imageUrl).toBe('/assets/images/naming/apple.png');
  });

  it('pickNamingItems: 사진이 없는 단어는 SVG로 폴백한다', () => {
    // 사진을 20개 다 갖추기 전에도 검사가 깨지면 안 된다.
    // 사진 없는 단어는 단어이해 SVG를 그대로 쓴다.
    const items = pickNamingItems(100);
    const withoutPhoto = items.filter(
      (i) => i.imageUrl.includes('/wordComp/'),
    );

    // 아직 대부분은 SVG 폴백이다.
    expect(withoutPhoto.length).toBeGreaterThan(0);
    for (const item of withoutPhoto) {
      expect(item.imageUrl).toMatch(/\.svg$/);
    }
  });

  it('pickNamingItems: 0개 요청 시 빈 배열', () => {
    expect(pickNamingItems(0)).toEqual([]);
  });

  // ── 레벨별 렌더 난이도 ──────────────────────────────────────
  describe('레벨 파라미터', () => {
    it('레벨이 낮을수록 선택지가 적고 높을수록 많다', () => {
      expect(pickWordItems(5, 1).every((i) => i.choices.length === 2)).toBe(true);
      expect(pickWordItems(5, 2).every((i) => i.choices.length === 3)).toBe(true);
      expect(pickWordItems(5, 3).every((i) => i.choices.length === 4)).toBe(true);
      expect(pickWordItems(5, 4).every((i) => i.choices.length === 4)).toBe(true);
      expect(pickWordItems(5, 5).every((i) => i.choices.length === 5)).toBe(true);
    });

    it('각 레벨에서도 정답은 정확히 1개다', () => {
      for (const lv of [1, 2, 3, 4, 5]) {
        for (const item of pickWordItems(10, lv)) {
          expect(item.choices.filter((c) => c.isCorrect)).toHaveLength(1);
          const urls = new Set(item.choices.map((c) => c.imageUrl));
          expect(urls.size).toBe(item.choices.length); // 중복 유인지 없음
        }
      }
    });

    /**
     * **오답 두 갈래가 레벨대로 채워지는가.**
     *
     * 예전 테스트는 `big = animal|food|object`로 **큰 범주만 검사했다.** 작은
     * 범주는 같은 범주 오답 3~4개를 못 채워 통과할 수 없었기 때문이다. 면제가
     * 곧 버그의 자백이었다 — 못 채운 자리는 무관 오답으로 조용히 메워져
     * 문항은 쉬워지고 기록만 레벨 4·5로 남았다(실측 20%·33%).
     *
     * 의미 오답을 2로 고정하니(최소 범주가 3개 = 정답 + 동료 2) 면제가 필요
     * 없다. 아래 테스트는 **90개 낱말 전부**를 훑는다.
     */
    describe('오답 구성이 레벨을 따른다', () => {
      const catOf = (url: string): string | null => {
        const slug = slugOf(url);
        return slug in WORD_CATEGORY ? WORD_CATEGORY[slug] : null;
      };

      /** 정답 기준으로 오답 하나를 의미/음운/무관으로 가른다. */
      function classify(targetLabel: string, targetCat: string | null, foil: {
        label: string;
        imageUrl: string;
      }): 'semantic' | 'phonological' | 'unrelated' {
        // 범주 없음(null)끼리는 같은 무리가 아니다 — `null === null`을 참으로 보면
        // 가방과 풍선이 의미 오답으로 잡힌다(E10이 고친 그 버그).
        if (targetCat !== null && catOf(foil.imageUrl) === targetCat) {
          return 'semantic';
        }
        const near = sharesInitialConsonant(targetLabel, foil.label);
        const loose = sharesOnsetOrNucleus(
          targetLabel.charAt(0),
          foil.label.charAt(0),
        );
        return near || loose ? 'phonological' : 'unrelated';
      }

      /**
       * @param onlyCategorized 범주 있는 낱말만 셀지. 범주 없는 아홉(가방·풍선·
       *   돌…)은 의미 오답을 가질 수 없어 섞으면 기대값이 흐려진다(E10).
       */
      function tally(level: number, onlyCategorized = false) {
        const out = { semantic: 0, phonological: 0, unrelated: 0, items: 0 };
        for (const item of pickWordItems(90, level)) {
          const correct = item.choices.find((c) => c.isCorrect)!;
          const cat = catOf(correct.imageUrl);
          if (onlyCategorized && cat === null) continue;
          out.items += 1;
          for (const f of item.choices.filter((c) => !c.isCorrect)) {
            out[classify(correct.label, cat, f)] += 1;
          }
        }
        return out;
      }

      it('의미 오답은 범주 있는 낱말 전부에서 스펙만큼 채워진다', () => {
        // 작은 범주(주방·욕실·연장·가구·악기·가전 = 3개짜리)도 예외가 아니다.
        // 여기가 무너지면 못 채운 자리가 무관 오답으로 메워져, 환자가 푼 문항은
        // 쉬운데 기록은 레벨 4·5가 된다.
        //
        // 범주 없는 아홉은 제외한다 — 의미 오답이 **0인 것이 맞는** 낱말들이고,
        // 그건 바로 아래 테스트가 따로 지킨다.
        for (const [level, want] of [[3, 2], [4, 2], [5, 2]] as const) {
          const t = tally(level, true);
          expect(t.semantic).toBe(t.items * want);
        }
      });

      it('범주 없는 낱말의 의미 자리는 음운으로 넘어간다', () => {
        // 못 채운 자리를 무관으로 흘려보내면 문항만 쉬워지고 기록은 그대로라
        // 레벨이 거짓말을 한다. 음운 오답은 90개 낱말 전부가 채울 수 있다.
        for (const target of masterWords().filter((w) => w.category === null)) {
          for (const lv of [3, 4, 5]) {
            const foils = buildControlledChoices(target, lv).filter(
              (c) => !c.isCorrect,
            );
            const kinds = foils.map((f) =>
              classify(target.label, null, f),
            );
            expect(kinds.filter((k) => k === 'semantic'), target.label)
              .toHaveLength(0);
            expect(
              kinds.filter((k) => k === 'phonological').length,
              `${target.label} lv${lv}: ${kinds.join(',')}`,
            ).toBeGreaterThanOrEqual(LEVEL_CHOICE_SPEC[lv].phon);
          }
        }
      });

      it('레벨 4·5에는 무관 오답이 없다', () => {
        // 무관 오답은 눈으로 바로 걸러진다. 최고 난도에 섞이면 그 문항은
        // 레벨이 약속한 난도가 아니다.
        expect(tally(4).unrelated).toBe(0);
        expect(tally(5).unrelated).toBe(0);
      });

      it('음운 오답 개수는 레벨 4에서 1개, 5에서 2개다', () => {
        // 어두 초성이 유일한 낱말(꽃·빵)은 1순위 후보가 0개라 느슨한 기준으로
        // 내려가 채운다. 개수를 줄이지 않는 것이 요점이다.
        //
        // 범주 없는 낱말은 의미 자리까지 음운으로 받으므로 여기서 뺀다.
        const four = tally(4, true);
        const five = tally(5, true);
        expect(four.phonological).toBe(four.items);
        expect(five.phonological).toBe(five.items * 2);
      });

      it('음운 오답은 정답과 다른 범주에서 온다', () => {
        // 의미와 음운이 한 오답에 겹치면 환자가 그걸 골랐을 때 어느 축에서
        // 틀렸는지 못 읽는다. 두 축을 나눈 목적이 그 구분이다.
        for (const item of pickWordItems(90, 5)) {
          const correct = item.choices.find((c) => c.isCorrect)!;
          const cat = catOf(correct.imageUrl);
          if (cat === null) continue; // 애초에 같은 범주가 있을 수 없다
          const phon = item.choices.filter(
            (c) =>
              !c.isCorrect &&
              classify(correct.label, cat, c) === 'phonological',
          );
          for (const f of phon) expect(catOf(f.imageUrl)).not.toBe(cat);
        }
      });

      it('레벨 3→4는 선택지 수가 같고 오답의 질만 바뀐다', () => {
        // 한 단계에 한 군데만 움직인다. 무관 1개가 음운 1개로 교체된다.
        //
        // 총합이 아니라 **문항당 값**을 본다. 표본이 무작위라 두 레벨의 문항 수가
        // 같다는 보장이 없다(범주 없는 낱말을 걸러내면 특히).
        expect(LEVEL_CHOICE_SPEC[3].total).toBe(LEVEL_CHOICE_SPEC[4].total);

        const three = tally(3, true);
        const four = tally(4, true);
        expect(three.semantic / three.items).toBe(four.semantic / four.items);
        expect(three.unrelated).toBeGreaterThan(0);
        expect(four.unrelated).toBe(0);
      });
    });

    it('presentedLevel을 항목에 스탬핑한다', () => {
      expect(pickWordItems(3, 4).every((i) => i.presentedLevel === 4)).toBe(true);
      expect(pickSentItems(3, 2).every((i) => i.presentedLevel === 2)).toBe(true);
    });

    it('레벨 미지정이면 presentedLevel도 undefined다 — 없는 사실을 만들지 않는다', () => {
      // 난이도는 콜드스타트(2)로 내지만, 서버가 정한 레벨이 아니므로 스탬핑은
      // 하지 않는다. 임의의 값을 찍으면 서버 기록과 어긋난다.
      expect(pickWordItems(5).every((i) => i.presentedLevel === undefined)).toBe(
        true,
      );
    });

    it('pickQabItems: 단어/문장 레벨을 각각 스탬핑한다', () => {
      const items = pickQabItems(qabItemCount(), { word: 1, sentence: 5 });
      for (const it of items) {
        expect(it.presentedLevel).toBe(it.category === 'word' ? 1 : 5);
      }
    });
  });
});

// ─── 글자 조합(spell) ─────────────────────────────────────────────
//
// 이 과제는 예전에 보호자 메모 기반으로 만들어져 (a) 기억 회상과 음절 조합이
// 한 문항에 겹치고 (b) 방해 타일이 늘 3개라 적응 레벨링이 붙지 않았다.
// 커리큘럼 단어 풀 기반으로 옮기면서 레벨이 난이도를 정하게 했다.

/**
 * 레벨 미지정(스킬 레벨 조회 실패)은 **모든 축에서 같은 값**이어야 한다.
 *
 * 축마다 따로 검증하면 이 어긋남을 못 잡는다. 실제로 그랬다 — 그림선택만
 * `normalizeLevel(level, 3)`으로 레벨 3을 쓰고 나머지 넷은 콜드스타트 2를 썼다.
 * 그러면 조회가 실패했을 때 환자는 선택지 4개(레벨 3)를 보는데 서버는 레벨 2로
 * 기록한다. 본 난이도와 기록이 어긋나면 적응 레벨링의 전제가 통째로 깨진다.
 *
 * 더 나쁜 건 그 동작을 **테스트가 "기존 동작"으로 고정하고 있었다**는 점이다.
 * 모순을 명세로 굳히면 고치려는 쪽이 실패를 본다.
 *
 * 그래서 축별이 아니라 **한 테스트**로 본다. 새 축을 만들고 여기 안 넣으면
 * 그 축만 조용히 다른 기본값을 쓰게 되므로, 축을 추가할 때 여기도 추가한다.
 */
describe('레벨 미지정 — 다섯 축이 모두 콜드스타트(2)를 쓴다', () => {
  const COLD_START = 2;
  const zero = (): number => 0;

  it('① 선택지 구성(그림선택)', () => {
    for (const word of ['사과', '가방', '비행기']) {
      const master = masterWords().find((w) => w.label === word)!;
      const 미지정 = buildControlledChoices(master, undefined);
      const 콜드 = buildControlledChoices(master, COLD_START);
      expect(미지정.length, word).toBe(콜드.length);
    }
  });

  it('② 방해 타일 수(글자 조합)', () => {
    expect(distractorCountForLevel(undefined)).toBe(
      distractorCountForLevel(COLD_START),
    );
  });

  it('③ 음절 범위 + ④ 유사 방해자 — 타일 구성이 통째로 같다', () => {
    // 두 축 모두 buildSpellTiles를 통해서만 드러난다. rng를 고정해 결정적으로 비교.
    for (const word of ['바다', '가나', '바나나']) {
      expect(buildSpellTiles(word, undefined, zero), word).toEqual(
        buildSpellTiles(word, COLD_START, zero),
      );
    }
  });

  it('⑤ 문장 통사 유형', () => {
    expect(sentTypeForLevel(undefined)).toBe(sentTypeForLevel(COLD_START));
  });

  it('레벨 3이 아니다 — 예전 그림선택 기본값이 되살아나면 걸린다', () => {
    // 이 단언이 이 파일의 요점이다. 레벨 2와 3은 선택지 수가 3개와 4개로 달라
    // 되돌아가면 여기서 바로 드러난다.
    const master = masterWords()[0];
    expect(buildControlledChoices(master, undefined).length).not.toBe(
      buildControlledChoices(master, 3).length,
    );
  });
});

describe('distractorCountForLevel', () => {
  it('레벨 1~2는 방해 타일이 없다', () => {
    // 가장 쉬운 진입 단계 — 정답 음절 재배열만. 예전 구현엔 이 단계가 없었다.
    expect(distractorCountForLevel(1)).toBe(0);
    expect(distractorCountForLevel(2)).toBe(0);
  });

  it('레벨 3은 2개, 4~5는 4개', () => {
    // 등급값은 상용 실어증 치료 도구를 따라 0/2/4 그대로다. 바뀐 것은 **꺾이는
    // 자리**뿐이다 — 예전엔 2와 4에서 꺾여 음절 축과 같은 자리에서 움직였다.
    expect(distractorCountForLevel(3)).toBe(2);
    expect(distractorCountForLevel(4)).toBe(4);
    expect(distractorCountForLevel(5)).toBe(4);
  });

  it('0·2·4 말고 다른 값은 쓰지 않는다', () => {
    // 등급값 자체는 임상 관례라 마음대로 늘리지 않는다. 5단계를 만드는 일은
    // 축을 엇갈리게 놓아서 하지, 중간값(1·3)을 지어내서 하지 않는다.
    for (const lv of [1, 2, 3, 4, 5]) {
      expect([0, 2, 4]).toContain(distractorCountForLevel(lv));
    }
  });

  it('범위를 벗어난 레벨은 클램프한다', () => {
    expect(distractorCountForLevel(0)).toBe(0);
    expect(distractorCountForLevel(9)).toBe(4);
  });
});

describe('buildSpellTiles', () => {
  const zeroRng = () => 0;

  it('정답 음절을 모두 담고 중복을 보존한다', () => {
    const tiles = buildSpellTiles('바나나', 1, zeroRng);

    expect(tiles).toHaveLength(3);
    expect([...tiles].sort()).toEqual(['나', '나', '바']);
  });

  it('레벨이 낮으면 방해 타일을 섞지 않는다', () => {
    const tiles = buildSpellTiles('바다', 1, zeroRng);

    expect([...tiles].sort()).toEqual(['다', '바']);
  });

  it('레벨이 높으면 방해 타일이 붙는다', () => {
    const tiles = buildSpellTiles('바다', 5, zeroRng);

    expect(tiles).toHaveLength(2 + 4);
    expect(tiles).toEqual(expect.arrayContaining(['바', '다']));
  });

  it('방해 타일은 정답 음절과 겹치지 않는다', () => {
    // 겹치면 "정답인데 오답 타일"이 생겨 환자가 만든 답이 틀리게 채점된다.
    const tiles = buildSpellTiles('가나', 5, zeroRng);
    const extras = [...tiles];
    for (const ch of ['가', '나']) extras.splice(extras.indexOf(ch), 1);

    expect(extras).not.toContain('가');
    expect(extras).not.toContain('나');
  });

  it('타일 총 개수가 상한을 넘지 않는다', () => {
    const tiles = buildSpellTiles('가나다라마바사', 5, zeroRng);

    expect(tiles.length).toBeLessThanOrEqual(8);
  });

  it('빈 목표는 빈 배열', () => {
    expect(buildSpellTiles('', 3, zeroRng)).toEqual([]);
    expect(buildSpellTiles('   ', 3, zeroRng)).toEqual([]);
  });
});

/**
 * **5단계 표시가 사실인가.**
 *
 * 이 앱은 환자에게 "레벨 3"을 보여주고 서버는 그 값을 회복 추세의 근거로 쓴다.
 * 레벨이 올라도 문제가 안 바뀌면 그 숫자는 거짓말이다. 2026-08-17 리뷰에서
 * 지적됐고(glyph-level-axis), 방해 수와 음절 범위가 **같은 자리에서 꺾여**
 * 레벨 1=2, 3=4였다. 이 describe가 그 회귀를 잡는다.
 */
describe('글자 조합 레벨이 실제로 5단계다', () => {
  /**
   * 그 레벨에서 나올 수 있는 타일 수의 범위.
   *
   * 한 번에 20개만 요청하는 이유가 있다. 3~4음절 낱말은 풀에 28개뿐이라 그보다
   * 많이 달라고 하면 `pickSpellItems`가 "세션이 비는 것보다 낫다"며 범위를 풀어
   * 2음절까지 섞어 준다. 그 폴백을 밟으면 레벨 구분이 아니라 폴백을 재게 된다.
   *
   * 대신 **여러 번 뽑아 합친다.** 한 번만 뽑으면 4음절 낱말(풀에 2개)이 표본에서
   * 통째로 빠져 `max`가 7과 8 사이를 오갔고, 이 describe가 3회 중 1회 실패했다.
   * 40회면 어떤 낱말이 한 번도 안 나올 확률이 사실상 0이다.
   */
  const 표본수 = 40;

  function tileRange(level: number): { min: number; max: number } {
    const counts = Array.from({ length: 표본수 }, () => {
      const items = pickSpellItems(20, level);
      expect(items).toHaveLength(20);
      return items.map((it) => it.tiles.length);
    }).flat();
    return { min: Math.min(...counts), max: Math.max(...counts) };
  }

  it('레벨 1→4는 타일 수 구간이 겹치지 않는다', () => {
    // 구간이 겹치면 두 레벨이 같은 문제를 낼 수 있다는 뜻이다. 예전 매핑에서는
    // 1과 2가 통째로 같았다(둘 다 2음절·방해 0 → 타일 2개).
    const ranges = [1, 2, 3, 4].map(tileRange);
    for (let i = 0; i + 1 < ranges.length; i += 1) {
      expect(ranges[i].max).toBeLessThan(ranges[i + 1].min);
    }
  });

  it('한 단계에 한 축만 움직인다 — 4→5는 절벽이 아니다', () => {
    // 예전에는 4→5에서 음절과 방해가 동시에 뛰었다. 지금 5는 4와 타일 수가
    // 같고 방해자의 **종류**만 다르다.
    expect(tileRange(5)).toEqual(tileRange(4));
  });

  it('레벨 5의 방해 타일은 정답 음절과 초성이나 중성을 공유한다', () => {
    // 무작위 방해자는 눈으로 걸러진다. 이게 레벨 4와 5를 가르는 유일한 축이라
    // 여기가 무너지면 5단계가 다시 4단계가 된다.
    const target = '바다';
    const tiles = buildSpellTiles(target, 5, () => 0);
    const extras = [...tiles];
    for (const ch of Array.from(target)) extras.splice(extras.indexOf(ch), 1);

    expect(extras).toHaveLength(4);
    for (const ex of extras) {
      expect(
        Array.from(target).some((a) => sharesOnsetOrNucleus(ex, a)),
      ).toBe(true);
    }
  });

  it('닮은 후보가 없어도 방해 타일 수는 줄지 않는다', () => {
    // 개수를 줄이면 환자가 푼 문항은 쉬워지는데 기록은 레벨 5로 남는다.
    // '켜터'는 방해 풀과 초성·중성이 하나도 안 겹친다(ㅋ·ㅌ / ㅕ·ㅓ).
    const tiles = buildSpellTiles('켜터', 5, () => 0);

    expect(tiles).toHaveLength(2 + 4);
  });
});

describe('pickSpellItems', () => {
  it('요청 개수만큼 커리큘럼 단어에서 뽑는다', () => {
    const items = pickSpellItems(3, 3);

    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.targetWord.length).toBeGreaterThanOrEqual(2);
      expect(it.tiles).toEqual(
        expect.arrayContaining(Array.from(it.targetWord)),
      );
      expect(it.presentedLevel).toBe(3);
    }
  });

  it('1음절 단어는 제외한다', () => {
    // 조합할 게 없어 과제가 성립하지 않는다.
    const items = pickSpellItems(50, 3);

    expect(items.every((it) => Array.from(it.targetWord).length >= 2)).toBe(true);
  });
});

describe('pickSpellItems — 난이도·중복·반복', () => {
  it('레벨이 낮으면 짧은 단어만 낸다', () => {
    // 방해 타일 수만으로는 난이도가 통제되지 않는다. 4음절+방해0은 2음절+방해0과
    // 전혀 다른 과제라, 길이를 안 묶으면 레벨별 정답률이 어휘 부하와 교란된다.
    const items = pickSpellItems(20, 1);

    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(Array.from(it.targetWord.replace(/\s+/g, ''))).toHaveLength(2);
    }
  });

  it('레벨이 높으면 긴 단어가 나온다', () => {
    const items = pickSpellItems(20, 5);

    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      const n = Array.from(it.targetWord.replace(/\s+/g, '')).length;
      expect(n).toBeGreaterThanOrEqual(3);
    }
  });

  it('제외 목록의 단어는 내지 않는다', () => {
    // 같은 세션의 단어이해가 정답을 TTS로 들려주므로 겹치면 답을 알려준 셈이다.
    const all = pickSpellItems(50, 3).map((it) => it.targetWord);
    const banned = all.slice(0, 3);

    const items = pickSpellItems(50, 3, { exclude: banned.map(asWordLabel) });

    for (const b of banned) {
      expect(items.map((it) => it.targetWord)).not.toContain(b);
    }
  });

  it('우선순위 문항을 앞으로 당긴다', () => {
    // 최근에 틀린 문항을 다시 내야 반복 훈련이 성립한다.
    //
    // 표본을 레벨 3의 낱말 수(3~4음절 28개) 안에서 잡는다. 넘겨서 달라고 하면
    // 범위를 푸는 폴백이 걸려 레벨 밖 낱말이 target이 되고, 그건 애초에 다시
    // 낼 수 없는 문항이라 우선순위가 아니라 폴백을 재게 된다.
    const pool = pickSpellItems(20, 3);
    const target = pool[pool.length - 1];

    const items = pickSpellItems(1, 3, { priority: [asItemRef(target.itemId)] });

    expect(items[0].itemId).toBe(target.itemId);
  });

  it('레벨 범위 밖 문항은 우선순위로도 끌어올리지 않는다', () => {
    // 재출제보다 레벨이 세다. 범위 밖 낱말을 우선순위로 끌어올리면 환자가 푼
    // 난이도와 `presentedLevel`이 어긋나는데, 그 어긋남이야말로 적응 레벨링이
    // 없애려는 교란이다. 조용히 빠지는 동작이라 여기 못으로 박아 둔다.
    const short = pickSpellItems(20, 1); // 레벨 1 = 2음절
    const items = pickSpellItems(1, 3, {
      priority: [asItemRef(short[0].itemId)],
    });

    expect(items[0].itemId).not.toBe(short[0].itemId);
  });

  it('레벨 범위에 맞는 단어가 부족하면 범위를 풀어 문항을 채운다', () => {
    // 문항이 조용히 사라지는 것보다 난이도가 조금 어긋나는 편이 낫다.
    const items = pickSpellItems(200, 5);

    expect(items.length).toBeGreaterThan(10);
  });

  it('count가 0이면 빈 배열', () => {
    expect(pickSpellItems(0, 3)).toEqual([]);
  });
});

/**
 * 문장이해 난이도 — 통사 복잡도.
 *
 * 예전엔 presentedLevel을 스탬핑만 하고 문항 구성은 레벨과 무관했다. 그러면
 * "레벨 5 정답률"이 실제로는 레벨 1과 같은 문항의 정답률이라, 보호자가 보는
 * 눈높이가 회복을 뜻하지 않는다.
 */
/**
 * **이름대기 전용 낱말.**
 *
 * 실사 사진은 있으나 Fluent에 아이콘이 없는 낱말들(빗·책상·수건·냉장고)이
 * 사진만 남은 채 한 번도 안 나오고 있었다. 이름대기는 자극이 한 장뿐이라
 * 선택지 격자가 없고 SVG도 필요 없는데, `pickNamingItems`가 선택지 풀에서
 * 파생하는 바람에 둘이 묶여 있었다.
 *
 * **그림 고르기로 새면 안 된다.** 한 선택지만 사진이면 낱말을 몰라도 그것만
 * 골라 다 맞아 그 문항이 '사진 찾기'가 된다.
 */
describe('이름대기 전용 낱말', () => {
  const ONLY = namingOnlyWords.items.map((w) => w.slug);

  it('이름대기에 실제로 나온다', () => {
    const naming = pickNamingItems(500);
    for (const slug of ONLY) {
      expect(
        naming.some((n) => n.imageUrl === `/assets/images/naming/${slug}.png`),
      ).toBe(true);
    }
  });

  it('그림 고르기에는 정답으로도 오답으로도 안 나온다', () => {
    // 여기가 무너지면 그 문항은 낱말을 몰라도 사진만 골라 맞는 문항이 된다.
    for (const it of pickWordItems(200, 5)) {
      for (const c of it.choices) {
        for (const slug of ONLY) expect(c.imageUrl).not.toContain(`/${slug}.`);
      }
    }
  });

  it('WORD_CATEGORY에 없다 — 범주 크기를 부풀리지 않는다', () => {
    // 그림 고르기에 안 나오므로 같은범주 오답 후보도 아니다. 욕실·가구·가전이
    // 늘어난 것처럼 보이면 레벨 4~5 오답 구성이 거짓말을 하게 된다.
    for (const slug of ONLY) expect(WORD_CATEGORY[slug]).toBeUndefined();
  });

  it('사진이 실제로 등록된 낱말만 둔다', () => {
    // 여기 slug에 사진이 없으면 환자 화면에 깨진 이미지가 뜬다.
    const photos = new Set<string>(namingPhotos.slugs);
    for (const slug of ONLY) expect(photos.has(slug)).toBe(true);
  });

  it('itemRef가 풀 문항과 구별된다', () => {
    // qab_results의 UNIQUE는 (patient, session, subtest, itemRef)다. 접두사가
    // 겹치면 다른 문항이 같은 행으로 접힌다.
    const naming = pickNamingItems(500);
    const only = naming.filter((n) =>
      ONLY.some((s) => n.imageUrl.includes(`/${s}.`)),
    );
    for (const n of only) expect(n.itemId).toMatch(/^naming_only_/);
  });
});

describe('pickSentItems — 통사 복잡도 위계', () => {
  const 반복추출 = (lv: number, times = 20): string[] =>
    Array.from({ length: times }, () => pickSentItems(2, lv))
      .flat()
      .map((i) => i.promptText);

  /**
   * promptText로 원본 sentenceType을 되찾는다(테스트 전용 역인덱스).
   * **뱅크와 같은 세 출처를 봐야 한다** — 하나라도 빠지면 undefined가 나와
   * 엉뚱한 실패로 보인다(실제로 qabSentGenerated를 빠뜨려 한 번 겪었다).
   */
  type RawSent = { sentence: string; sentenceType: string };
  const ALL_SENTS: RawSent[] = [
    ...(sentCompRaw as RawSent[]),
    ...(sentMirrorRaw as { items: RawSent[] }).items,
    ...(sentGeneratedRaw as { items: RawSent[] }).items,
  ];
  function typeOf(prompt: string): string | undefined {
    return ALL_SENTS.find((x) => x.sentence === prompt)?.sentenceType;
  }

  it('레벨 1~2는 능동/수동만 낸다 — 절이 하나뿐인 가장 단순한 유형', () => {
    for (const prompt of 반복추출(1)) {
      expect(typeOf(prompt)).toBe('active-passive');
    }
  });

  it('레벨을 안 주면 콜드스타트(2)의 유형을 낸다', () => {
    expect(sentTypeForLevel()).toBe(sentTypeForLevel(2));
  });

  it('허용 유형이 부족하면 전체 풀로 되돌려 세션이 비지 않게 한다', () => {
    // 문항이 조용히 사라지는 것보다 난이도가 어긋나는 편이 낫다.
    // 내포절 밴드가 4문항이라, 100개를 달라고 하면 되돌림이 걸린다.
    expect(pickSentItems(100, 5).length).toBeGreaterThan(4);
  });

  /**
   * **밴드가 누적이면 레벨 안에서 난이도가 희석된다.**
   *
   * 예전에는 허용 유형이 누적이라(레벨 5 = 능동수동 + 관계절 + 내포절) 레벨 5에서
   * 내포절이 뽑힐 확률이 4/26 = 15%뿐이었다. "레벨 5 정답률"의 85%가 낮은 레벨과
   * 같은 문항이었고, 적응 레벨링은 그 부풀린 값으로 승급을 판단했다.
   */
  it('각 레벨은 자기 유형만 낸다 — 누적이 아니다', () => {
    const expected: Array<[number, string]> = [
      [1, 'active-passive'],
      [2, 'active-passive'],
      [3, 'relative-clause'],
      [4, 'relative-clause'],
      [5, 'embedded-clause'],
    ];
    for (const [lv, type] of expected) {
      const seen = new Set(반복추출(lv, 40).map(typeOf));
      expect([...seen]).toEqual([type]);
    }
  });
});

/**
 * **검사 구성이 환자 실력에 따라 달라지면 안 된다.**
 *
 * 예전에는 단어 풀과 문장 풀을 한 통에 붓고 섞어서, 레벨이 허용하는 문장 수가
 * 곧 추첨 가중치가 됐다. 환자의 문장 레벨이 오를수록 문장 문항이 더 자주 나온다 —
 * 실측 13.7%(레벨 1~2) → 20.3%(3~4) → 22.7%(5). 하위검사끼리 비교가 깨진다.
 *
 * 통사 유형을 비누적으로 바꾸면 이 새는 구멍이 더 커진다(내포절 4문항 → 4%).
 * 그래서 두 수정이 한 묶음이다.
 */
describe('pickQabItems — 단어/문장 몫', () => {
  /** 레벨 lv에서 QAB 슬롯 중 문장이 차지한 비율. */
  function sentShare(lv: number, draws = 3000): number {
    let sent = 0;
    let total = 0;
    for (let i = 0; i < draws; i += 1) {
      for (const it of pickQabItems(2, { word: 3, sentence: lv })) {
        total += 1;
        if (it.category === 'sentence') sent += 1;
      }
    }
    return sent / total;
  }

  it('문장 출제 비율이 문장 레벨에 흔들리지 않는다', () => {
    const shares = [1, 3, 5].map((lv) => sentShare(lv));
    // 통사 유형별 풀 크기는 14 / 8 / 4로 3.5배 차이가 난다. 그게 비율에 새면
    // 여기서 벌어진다. 무작위 추출이라 폭을 조금 준다.
    for (const sh of shares) {
      expect(Math.abs(sh - shares[0])).toBeLessThan(0.03);
    }
  });

  it('요청 개수를 정확히 채운다', () => {
    for (const lv of [1, 3, 5]) {
      for (let i = 0; i < 50; i += 1) {
        expect(pickQabItems(2, { word: 3, sentence: lv })).toHaveLength(2);
      }
    }
  });
});

describe('의미 범주 태그 (D5·E10)', () => {
  /** 문항 풀에 실제로 등장하는 정답 slug 전부. */
  function 풀의slug(): string[] {
    const out = new Set<string>();
    for (const item of pickWordItems(500, 3)) {
      const correct = item.choices.find((c) => c.isCorrect)!;
      out.add(slugOf(correct.imageUrl));
    }
    return [...out];
  }

  it('풀의 모든 낱말이 WORD_CATEGORY에 등록돼 있다', () => {
    // 예전엔 `WORD_CATEGORY[slug] ?? 'object'`라, 태그를 빠뜨린 낱말이 조용히
    // 잡동사니 범주에 섞였다. 폴백을 없앤 대신 여기서 지킨다 — 새 낱말을 넣고
    // 태그를 안 달면 바로 걸린다.
    const 미등록 = 풀의slug().filter((slug) => !(slug in WORD_CATEGORY));
    expect(미등록, `태그 없는 낱말: ${미등록.join(', ')}`).toEqual([]);
  });

  it('범주 없는 낱말은 의미 오답을 갖지 않는다', () => {
    // 가방의 "같은 범주 오답"이 풍선·돌이던 시절, 그 행에 foil_kind='semantic'이
    // 찍혔다. 의미 손상과 음운 손상을 가르려고 만든 신호가 오염된 것이다.
    const 범주없는낱말 = masterWords().filter((w) => w.category === null);
    expect(범주없는낱말.length).toBeGreaterThan(0);

    for (const target of 범주없는낱말) {
      for (const lv of [2, 3, 4, 5]) {
        const foils = buildControlledChoices(target, lv);
        const semantic = foils.filter((f) => f.foilKind === 'semantic');
        expect(semantic, `${target.label} lv${lv}`).toHaveLength(0);
      }
    }
  });

  it('범주 없는 낱말도 오답 개수는 레벨이 약속한 만큼 채운다', () => {
    // 의미 자리를 못 채운다고 문항이 짧아지면 안 된다 — 그 자리는 음운으로 간다.
    for (const target of masterWords().filter((w) => w.category === null)) {
      for (const lv of [1, 2, 3, 4, 5]) {
        expect(buildControlledChoices(target, lv), `${target.label} lv${lv}`)
          .toHaveLength(LEVEL_CHOICE_SPEC[lv].total);
      }
    }
  });

  it('정답이 자기 오답으로 들어오지 않는다', () => {
    // 범주 비교만으로 자기 자신을 걸러내던 코드가 있었다. 범주 없음끼리는
    // "같은 범주"가 아니라서 그 방법이 무너진다.
    for (const target of masterWords()) {
      for (const lv of [1, 3, 5]) {
        const slugs = buildControlledChoices(target, lv).map((c) =>
          slugOf(c.imageUrl),
        );
        expect(
          slugs.filter((sl) => sl === target.slug),
          `${target.label} lv${lv}`,
        ).toHaveLength(1); // 정답 1개뿐
      }
    }
  });
});
