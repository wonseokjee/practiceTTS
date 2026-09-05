// QabSpeechBank.ts — 발화 검사 자극 뱅크 테스트

import { describe, expect, it } from 'vitest';
import stimuli from '../../../../assets/data/qabSpeechStimuli.json';
import {
  ddkSpecForLevel,
  pickDdkItems,
  pickReadingItems,
  pickRepeatItems,
  readingRangeForLevel,
  repeatSpecForLevel,
} from './QabSpeechBank.js';

const 어절수 = (s: string): number => s.trim().split(/\s+/).length;
const 음절수 = (s: string): number => Array.from(s.replace(/\s+/g, '')).length;

/**
 * 레벨 밴드에 실제로 드는 읽기 자극.
 *
 * `pickReadingItems(999, lv)`로는 못 센다 — 요청이 밴드보다 크면 되돌리기가
 * 걸려 **전체 풀**이 돌아온다. 밴드를 재려면 자료를 규칙(`readingRangeForLevel`)에
 * 직접 걸어야 한다.
 */
function 읽기밴드(level: number): string[] {
  const { min, max } = readingRangeForLevel(level);
  return stimuli.readingSentences.filter((s) => {
    const n = 어절수(s);
    return n >= min && n <= max;
  });
}

/**
 * 레벨 밴드에 실제로 드는 따라말하기 자극.
 *
 * 읽기와 달리 통이 둘이고 **재는 단위가 다르다** — 단어는 음절, 문장은 어절.
 * 레벨이 통까지 정한다(`kind`).
 */
function 따라말하기밴드(level: number): string[] {
  const { kind, min, max } = repeatSpecForLevel(level);
  const 범위 = (n: number): boolean => n >= min && n <= max;
  const 단어 = kind === 'sentence' ? [] : stimuli.repeatWords.filter((w) => 범위(음절수(w)));
  const 문장 =
    kind === 'word' ? [] : stimuli.repeatSentences.filter((s) => 범위(어절수(s)));
  return [...단어, ...문장];
}

describe('QabSpeechBank', () => {
  it('pickRepeatItems: 요청 개수만큼, 단어/문장 카테고리를 가진다', () => {
    const items = pickRepeatItems(4);
    expect(items).toHaveLength(4);
    for (const it of items) {
      expect(it.text.length).toBeGreaterThan(0);
      expect(['word', 'sentence']).toContain(it.category);
      expect(it.instruction.length).toBeGreaterThan(0);
    }
  });

  it('pickReadingItems: 요청 개수만큼 텍스트 문항을 반환', () => {
    const items = pickReadingItems(3);
    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.text.length).toBeGreaterThan(0);
    }
  });

  it('pickDdkItems: 음절/목표횟수를 가진다', () => {
    const items = pickDdkItems(2);
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.syllable.length).toBeGreaterThan(0);
      expect(it.label.length).toBeGreaterThan(0);
      expect(it.targetCount).toBeGreaterThan(0);
    }
  });

  it('0개 요청 시 빈 배열', () => {
    expect(pickRepeatItems(0)).toEqual([]);
    expect(pickReadingItems(0)).toEqual([]);
    expect(pickDdkItems(0)).toEqual([]);
  });
});

/**
 * 레벨별 난이도 통제.
 *
 * 이 셋은 예전에 레벨을 **받지도 않고** 문항을 골랐다. 그런데 보호자 화면은
 * loc를 뺀 모든 검사에 1~5단계 눈높이가 있다고 표시했다 — 같은 과제를 계속
 * 내면서 숫자만 오르내리는 구조였고, 재활 앱에서 그건 보호자의 임상 판단을
 * 오염시키는 거짓 신호다.
 *
 * 그래서 여기서 검증하는 건 "레벨 인자를 받는다"가 아니라 **레벨이 실제로 다른
 * 문항을 고른다**는 것이다. 인자만 받고 무시해도 통과하는 테스트는 의미가 없다.
 *
 * 요청 개수는 실제 세션 규모(검사당 1~3문항)에 맞춘다. 레벨별 후보보다 많이
 * 요청하면 의도된 폴백(범위를 풀어 세션을 채운다)이 걸려 범위 밖 문항이 나온다 —
 * 그건 결함이 아니라 설계이므로 따로 검증한다.
 */
describe('QabSpeechBank — 레벨별 난이도', () => {
  const 어절 = (s: string): number => s.trim().split(/\s+/).length;
  const 음절 = (s: string): number => Array.from(s.replace(/\s+/g, '')).length;
  /** 무작위 추출이라 한 번으로는 못 믿는다 — 여러 번 뽑아 합친다. */
  const 반복추출 = <T,>(pick: () => T[], times = 20): T[] =>
    Array.from({ length: times }, pick).flat();

  describe('따라말하기', () => {
    it('레벨 1은 1~2음절 단어만 낸다 — 문장은 청각 작업기억까지 요구한다', () => {
      const items = 반복추출(() => pickRepeatItems(3, 1));

      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        expect(it.category).toBe('word');
        expect(음절(it.text)).toBeLessThanOrEqual(2);
      }
    });

    it('레벨 5는 5~7어절 문장만 낸다', () => {
      const items = 반복추출(() => pickRepeatItems(3, 5));

      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        expect(it.category).toBe('sentence');
        expect(어절(it.text)).toBeGreaterThanOrEqual(5);
        expect(어절(it.text)).toBeLessThanOrEqual(7);
      }
    });

    it('레벨 1과 5의 문항이 전혀 겹치지 않는다 — 겹치면 눈높이가 무의미하다', () => {
      const low = new Set(반복추출(() => pickRepeatItems(3, 1)).map((i) => i.text));
      const high = 반복추출(() => pickRepeatItems(3, 5)).map((i) => i.text);

      expect(high.every((t) => !low.has(t))).toBe(true);
    });

    it('레벨을 안 주면 콜드스타트(2)로 떨어진다 — 백엔드와 같은 값', () => {
      for (const it of 반복추출(() => pickRepeatItems(3))) {
        expect(it.category).toBe('word');
        expect(음절(it.text)).toBeGreaterThanOrEqual(2);
        expect(음절(it.text)).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('소리 내어 읽기', () => {
    it('레벨이 오르면 문장이 길어진다', () => {
      const low = 반복추출(() => pickReadingItems(2, 1));
      const high = 반복추출(() => pickReadingItems(2, 5));

      const maxLow = Math.max(...low.map((i) => 어절(i.text)));
      const minHigh = Math.min(...high.map((i) => 어절(i.text)));
      expect(minHigh).toBeGreaterThan(maxLow);
    });

    it('어떤 레벨에서도 7어절을 넘지 않는다 — 그보다 길면 검사가 아니라 좌절이다', () => {
      for (const lv of [1, 2, 3, 4, 5]) {
        for (const it of 반복추출(() => pickReadingItems(2, lv), 5)) {
          expect(어절(it.text)).toBeLessThanOrEqual(7);
        }
      }
    });
  });

  describe('말운동(DDK)', () => {
    it('낮은 레벨은 AMR(단음절)만 낸다', () => {
      // SMR('퍼터커')은 조음 위치를 바꿔가며 내야 해서 구음장애에서 먼저 무너진다.
      for (const lv of [1, 2, 3]) {
        for (const it of 반복추출(() => pickDdkItems(1, lv))) {
          expect(음절(it.syllable)).toBe(1);
        }
      }
    });

    it('레벨 4는 전환 1회(2음절), 레벨 5는 전환 2회(3음절)만 낸다', () => {
      // SMR 자극이 '퍼터커' 하나뿐이면 로테이션의 3문항을 폴백 없이 못 채운다.
      // 전환 수로 두 밴드를 갈라 각 밴드에 자극 3개씩을 두었다.
      for (const it of 반복추출(() => pickDdkItems(1, 4))) {
        expect(음절(it.syllable)).toBe(2);
      }
      for (const it of 반복추출(() => pickDdkItems(1, 5))) {
        expect(음절(it.syllable)).toBe(3);
      }
    });

    it('높은 레벨은 SMR만 낸다 — 밴드가 누적되지 않는다', () => {
      // 예전엔 `allowSmr || 단음절`이라 레벨 5가 AMR을 그대로 낼 수 있었다.
      // 그러면 레벨 5로 기록된 문항이 실제로는 레벨 1 문항이다(#59·#60과 같은 버그).
      for (const lv of [4, 5]) {
        for (const it of 반복추출(() => pickDdkItems(1, lv))) {
          expect(음절(it.syllable)).toBeGreaterThan(1);
        }
      }
    });

    it('다섯 레벨이 서로 다른 요구를 낸다 — 종류가 같아도 반복 횟수가 다르다', () => {
      // 종류(AMR/SMR)만으로는 밴드가 둘뿐이다. 표준 자극이 AMR 3 + SMR 1이라
      // 자극을 늘려 해결할 수 없으므로 반복 요구량이 두 번째 축이다.
      const 요구 = [1, 2, 3, 4, 5].map((lv) => {
        const spec = ddkSpecForLevel(lv);
        return `${spec.kind}:${spec.targetCount}`;
      });

      expect(new Set(요구).size).toBe(5);
      // 같은 종류 안에서는 레벨이 오를수록 더 많이 요구한다.
      expect(ddkSpecForLevel(1).targetCount).toBeLessThan(ddkSpecForLevel(2).targetCount);
      expect(ddkSpecForLevel(2).targetCount).toBeLessThan(ddkSpecForLevel(3).targetCount);
      expect(ddkSpecForLevel(4).targetCount).toBeLessThan(ddkSpecForLevel(5).targetCount);
    });

    it('모든 밴드에 자극이 3개 이상이다 — 로테이션의 3문항을 폴백 없이 채운다', () => {
      // 폴백이 걸리면 밴드가 다시 섞여 레벨 기록이 거짓이 된다(E6가 그 버그였다).
      for (const lv of [1, 2, 3, 4, 5]) {
        const ids = new Set(pickDdkItems(3, lv).map((i) => i.itemId));
        expect(ids.size, `lv${lv}`).toBe(3);
      }
      // 그리고 그 3개가 전부 같은 밴드다.
      for (const lv of [1, 2, 3, 4, 5]) {
        const 음절수 = pickDdkItems(3, lv).map((i) => 음절(i.syllable));
        expect(new Set(음절수).size, `lv${lv}: ${음절수.join(',')}`).toBe(1);
      }
    });

    it('추출한 문항의 목표 횟수는 레벨이 정한다', () => {
      for (const lv of [1, 2, 3, 4, 5]) {
        const spec = ddkSpecForLevel(lv);
        for (const it of 반복추출(() => pickDdkItems(1, lv))) {
          expect(it.targetCount).toBe(spec.targetCount);
        }
      }
    });
  });

  it('레벨 범위의 문항이 부족하면 범위를 풀어 세션이 비지 않게 한다', () => {
    // 문항이 조용히 사라지는 것보다 난이도가 조금 어긋나는 편이 낫다.
    //
    // 요청 수를 **밴드 크기에서 끌어온다.** 예전엔 `pickReadingItems(10, 1)`이
    // 3보다 큰지 봤는데, 그때 레벨1 밴드가 3개뿐이라 10을 부르면 폴백이 걸렸다.
    // 밴드를 39개로 늘리자 10은 폴백 없이 채워졌고 — 10 > 3이라 테스트는 그냥
    // 통과했다. 재려던 것을 더 이상 안 보는데 초록불이 켜지는 상태다.
    const 밴드 = 읽기밴드(1).length;
    const 폴백 = pickReadingItems(밴드 + 5, 1);
    expect(폴백.length).toBe(밴드 + 5);
    expect(폴백.some((it) => it.bandFallback === true)).toBe(true);

    expect(pickDdkItems(4, 1).length).toBe(4);
  });
});

/**
 * `PickSpeechOptions.exclude` — 겹침 방지(다양성).
 *
 * word·sentence·naming과 같은 이유·같은 모양이다. repeat·reading은 spell과
 * 달리 원래 재출제 장치가 없던 순수 무작위 검사였고, 정답률이 같은 레벨·추세로
 * 나가므로 다양성 처방을 쓴다(TODOS "QAB 세션" 절, 2026-09-02).
 */
describe('pickRepeatItems — exclude(겹침 방지)', () => {
  it('exclude에 있는 itemId는 안 나온다', () => {
    const first = pickRepeatItems(5, 3);
    const exclude = new Set(first.map((i) => i.itemId));
    const second = pickRepeatItems(5, 3, { exclude });
    for (const it of second) {
      expect(exclude.has(it.itemId), it.itemId).toBe(false);
    }
  });

  it('exclude가 밴드를 통째로 비우면 같은 레벨 안에서 겹침을 허용한다', () => {
    // 레벨5가 가장 얇은 밴드다(문장뿐). 전부 exclude해도 bandFallback은
    // 안 붙어야 한다 — 겹침이 레벨보다 먼저 풀리는 단이다.
    const wholeBand = pickRepeatItems(999, 5);
    const exclude = new Set(wholeBand.map((i) => i.itemId));
    const picked = pickRepeatItems(3, 5, { exclude });
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((i) => i.bandFallback === undefined)).toBe(true);
  });

  it('exclude 없이 부르면 예전과 같다', () => {
    expect(pickRepeatItems(3, 2)).toHaveLength(3);
  });
});

describe('pickReadingItems — exclude(겹침 방지)', () => {
  it('exclude에 있는 itemId는 안 나온다', () => {
    const first = pickReadingItems(3, 3);
    const exclude = new Set(first.map((i) => i.itemId));
    const second = pickReadingItems(3, 3, { exclude });
    for (const it of second) {
      expect(exclude.has(it.itemId), it.itemId).toBe(false);
    }
  });

  it('exclude가 밴드를 통째로 비우면 같은 레벨 안에서 겹침을 허용한다', () => {
    // 밴드를 통째로 exclude하면 밴드 안에서는 못 채우고, 밴드 자체는 그대로
    // 써서 bandFallback 없이 채워야 한다. 겹침이 레벨보다 먼저 풀리는 단이다.
    const wholeBand = pickReadingItems(999, 1);
    const exclude = new Set(wholeBand.map((i) => i.itemId));
    const picked = pickReadingItems(2, 1, { exclude });
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((i) => i.bandFallback === undefined)).toBe(true);
  });

  it('exclude 없이 부르면 예전과 같다', () => {
    expect(pickReadingItems(2, 2)).toHaveLength(2);
  });
});

/**
 * 밴드 크기 — **겹침 방지가 실제로 작동하려면 얼마나 필요한가.**
 *
 * exclude를 배선해도(#125·#127) 밴드가 얇으면 아무 일도 일어나지 않는다.
 * 최근에 낸 것을 빼고 나면 후보가 요청 수보다 적어져 되돌리기가 걸리고,
 * 결국 같은 문항이 다시 나온다. 기능은 있는데 콘텐츠가 못 먹여주는 상태다.
 *
 * **필요한 수는 조회 창이 정한다.** `useMixedQuizSession`의 `fetchExclude`는
 * `getRecentItems(subtest)`를 days 없이 부르고, 백엔드 기본값이 30일이다
 * (`quiz.controller.ts`). 로테이션은 하루 하위검사 3개 × 검사당 3문항이라
 * 한 검사가 주 9문항 나간다. 그래서
 *
 *     30일 ÷ 7일 × 9문항 ≈ 39
 *
 * 가 "조회 창 안에서 한 번도 안 겹치는" 최소 밴드 크기다.
 *
 * **90일 무겹침(116개)에 콘텐츠는 닿았다(2026-09-05).** 다섯 레벨 전부
 * 116개를 채웠다 — 읽기·따라말하기 양쪽 다. 다만 이걸로 90일 무겹침이
 * 저절로 되는 건 아니다 — 조회 창(`fetchExclude`)이 아직 30일 기본값이라,
 * 90일 무겹침을 실제로 쓰려면 그 창도 90일로 올려야 짝이 맞는다(`days`는
 * 180까지 받는다). 그건 콘텐츠와 별개의 결정이라 TODOS에 남겨 둔다.
 *
 * **밴드는 겹친다**(lv2=2~3어절, lv3=3~4어절 …). 그래서 길이별 개수가 아니라
 * 레벨별로 실제 후보 수를 세야 한다.
 *
 * 세는 일을 `pickReadingItems(999, lv)`에게 시킬 수는 없다 — 요청이 밴드보다
 * 크면 되돌리기가 걸려 **전체 풀**이 돌아온다. 자료를 규칙에 직접 건다.
 */
describe('소리 내어 읽기 — 밴드 크기', () => {
  /** 90일 무겹침(콘텐츠 쪽 목표)에 필요한 밴드마다의 최소 문항 수. */
  const 최소밴드 = 116;

  it('다섯 레벨 모두 116개 이상이다', () => {
    for (const lv of [1, 2, 3, 4, 5]) {
      expect(읽기밴드(lv).length, `lv${lv}`).toBeGreaterThanOrEqual(최소밴드);
    }
  });

  it('로테이션 한 달치를 겹침 없이 낼 수 있다', () => {
    // 위 숫자가 무슨 뜻인지를 행동으로 확인한다. 주 9문항 × 30일이면
    // 39문항 — 그동안 낸 것을 계속 exclude에 쌓아도 되돌리기가 안 걸려야 한다.
    for (const lv of [1, 2, 3, 4, 5]) {
      const seen = new Set<string>();
      for (let session = 0; session < 13; session += 1) {
        const picked = pickReadingItems(3, lv, { exclude: seen });
        expect(picked, `lv${lv} 세션${session}`).toHaveLength(3);
        for (const it of picked) {
          expect(seen.has(it.itemId), `lv${lv}에서 ${it.text} 재출제`).toBe(
            false,
          );
          expect(it.bandFallback, `lv${lv} 세션${session} 되돌림`).toBe(
            undefined,
          );
          seen.add(it.itemId);
        }
      }
      expect(seen.size, `lv${lv}`).toBe(39);
    }
  });
});

/**
 * 따라말하기도 같은 기준이다 — 밴드마다 116개.
 *
 * 읽기와 다른 점 둘. **통이 둘이고 재는 단위가 다르다**(단어는 음절, 문장은
 * 어절), 그리고 레벨이 어느 통을 쓸지도 정한다(`kind`). 그래서 lv3(섞임)은
 * 두 통에서 함께 채워진다.
 */
describe('따라말하기 — 밴드 크기', () => {
  const 최소밴드 = 116;

  it('다섯 레벨 모두 116개 이상이다', () => {
    for (const lv of [1, 2, 3, 4, 5]) {
      expect(따라말하기밴드(lv).length, `lv${lv}`).toBeGreaterThanOrEqual(
        최소밴드,
      );
    }
  });

  it('로테이션 한 달치를 겹침 없이 낼 수 있다', () => {
    for (const lv of [1, 2, 3, 4, 5]) {
      const seen = new Set<string>();
      for (let session = 0; session < 13; session += 1) {
        const picked = pickRepeatItems(3, lv, { exclude: seen });
        expect(picked, `lv${lv} 세션${session}`).toHaveLength(3);
        for (const it of picked) {
          expect(seen.has(it.itemId), `lv${lv}에서 ${it.text} 재출제`).toBe(
            false,
          );
          expect(it.bandFallback, `lv${lv} 세션${session} 되돌림`).toBe(
            undefined,
          );
          seen.add(it.itemId);
        }
      }
      expect(seen.size, `lv${lv}`).toBe(39);
    }
  });
});

/**
 * 읽기와 따라말하기는 **같은 문장을 쓰면 안 된다.**
 *
 * 두 검사가 재는 것이 다르다 — 읽기는 글자를 소리로 바꾸는 일이고,
 * 따라말하기는 들은 것을 붙드는 일이다. 그런데 같은 문장이 양쪽에 있으면
 * "며칠 전에 읽어 봤다"가 따라말하기 점수에 섞인다. 정답률이 능력이 아니라
 * 노출 이력을 재게 되는데, 그건 이 풀 확장이 없애려는 교란 그 자체다.
 *
 * 자극을 쓰다 실제로 하나 겹쳤다(`누나가 창문을 닦아요`). 눈으로는 못 잡는다.
 */
describe('읽기와 따라말하기 자극', () => {
  it('한 문장도 겹치지 않는다', () => {
    const 읽기 = new Set<string>(stimuli.readingSentences);
    const 겹침 = stimuli.repeatSentences.filter((s) => 읽기.has(s));
    expect(겹침, `\n겹친 문장:\n${겹침.join('\n')}\n`).toEqual([]);
  });
});

/**
 * 어느 레벨도 안 고르는 자극이 있다 — `repeatSentences`의 2어절 셋.
 *
 * 따라말하기에서 문장이 처음 나오는 곳은 lv3(섞임 3~4어절)이고, lv1·lv2는
 * 단어만 낸다. 그래서 2어절 문장은 되돌림이 걸렸을 때만 화면에 나온다.
 *
 * **버그로 보고 지우지 말 것.** 짧은 발화는 단어 통이 이미 담당하므로 설계가
 * 맞다. 이 테스트는 그 사실을 적어 두는 자리다 — 다음 사람이 "2어절 밴드가
 * 얇네" 하고 문장을 더 넣는 일을 막는다. 정말 필요해지면 늘릴 것은 자극이
 * 아니라 `repeatSpecForLevel`의 범위다.
 */
describe('따라말하기 — 안 쓰이는 자극', () => {
  it('2어절 문장은 어느 레벨의 밴드에도 안 들어간다', () => {
    const 짧은문장 = stimuli.repeatSentences.filter((s) => 어절수(s) === 2);
    expect(짧은문장.length).toBeGreaterThan(0);

    const 모든밴드 = new Set([1, 2, 3, 4, 5].flatMap(따라말하기밴드));
    for (const s of 짧은문장) {
      expect(모든밴드.has(s), s).toBe(false);
    }
  });
});
