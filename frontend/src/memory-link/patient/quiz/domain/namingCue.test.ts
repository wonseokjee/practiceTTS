// 단서 위계 — spec 7절의 표를 그대로 옮긴 것이다.
// (docs/history/20260830_NamingCueHierarchy_feature_plan.md)

import { describe, expect, it } from 'vitest';
import {
  CUE_GIVEN,
  CUE_LADDER,
  CUE_NONE,
  CUE_PHONEMIC,
  CUE_SEMANTIC,
  CUE_SENTENCE,
  choseongOf,
  cueForLevel,
  hasCue,
  nextCueLevel,
} from './namingCue';
import { WORD_CATEGORY, pickNamingItems } from '../infrastructure/QabItemBank';

describe('choseongOf', () => {
  it('한글 음절의 첫 자음을 뽑는다', () => {
    expect(choseongOf('책')).toBe('ㅊ');
    expect(choseongOf('사')).toBe('ㅅ');
    expect(choseongOf('꽃')).toBe('ㄲ');
    expect(choseongOf('입')).toBe('ㅇ');
  });

  it('한글이 아니면 null', () => {
    expect(choseongOf('a')).toBeNull();
    expect(choseongOf('')).toBeNull();
    expect(choseongOf('ㄱ')).toBeNull(); // 자모 낱자는 음절이 아니다
  });
});

describe('cueForLevel — 의미 단서', () => {
  it('범주로 문장을 만든다', () => {
    const cue = cueForLevel('사과', 'food', CUE_SEMANTIC);
    expect(cue?.text).toBe('먹는 거예요.');
    expect(cue?.speak).toBe('먹는 거예요.');
  });

  it('범주가 없으면 주지 않는다', () => {
    // 91개 중 9개가 그렇다: 가방·풍선·바구니·양초·우체통·돌·우산·열쇠·시계
    expect(cueForLevel('가방', null, CUE_SEMANTIC)).toBeNull();
    expect(hasCue('가방', null, CUE_SEMANTIC)).toBe(false);
  });

  it('WORD_CATEGORY의 범주를 빠짐없이 덮는다', () => {
    // 하나라도 빠지면 그 낱말들이 조용히 의미 단서를 못 받는다.
    const 범주들 = [
      ...new Set(Object.values(WORD_CATEGORY).filter((c): c is string => c !== null)),
    ];
    const 빠진것 = 범주들.filter((c) => cueForLevel('아무거나', c, CUE_SEMANTIC) === null);
    expect(빠진것, `단서 문장 없는 범주: ${빠진것.join(', ')}`).toEqual([]);
  });
});

describe('cueForLevel — 음소 단서', () => {
  it('두 글자 이상이면 첫 음절을 준다', () => {
    const cue = cueForLevel('사과', 'food', CUE_PHONEMIC);
    expect(cue?.text).toBe('사…');
    expect(cue?.speak).toBe('사');
  });

  it('한 글자면 초성만 준다 — 정답 전체를 주지 않는다', () => {
    // 91개 중 13개가 한 글자다. 첫 음절을 주면 3단계와 통과가 같아져
    // 사다리가 꼭대기에서 무너진다.
    for (const w of ['책', '꽃', '칼', '돌', '배', '곰', '집', '손', '발', '눈', '귀', '코', '입']) {
      const cue = cueForLevel(w, null, CUE_PHONEMIC);
      expect(cue, w).not.toBeNull();
      expect(cue!.text, w).not.toContain(w);
    }
  });

  it('자모는 이름으로 읽어 준다 — TTS가 "ㅊ"을 못 읽는다', () => {
    expect(cueForLevel('책', null, CUE_PHONEMIC)?.text).toBe('첫소리는 ㅊ');
    expect(cueForLevel('책', null, CUE_PHONEMIC)?.speak).toBe('첫소리는 치읓이에요.');
  });
});

describe('nextCueLevel — 사다리', () => {
  it('범주가 있으면 무단서 → 의미 → 문장 → 음소 → 통과', () => {
    expect(nextCueLevel('사과', 'food', CUE_NONE)).toBe(CUE_SEMANTIC);
    expect(nextCueLevel('사과', 'food', CUE_SEMANTIC)).toBe(CUE_SENTENCE);
    expect(nextCueLevel('사과', 'food', CUE_SENTENCE)).toBe(CUE_PHONEMIC);
    expect(nextCueLevel('사과', 'food', CUE_PHONEMIC)).toBe(CUE_GIVEN);
  });

  it('범주가 없으면 의미 단서만 건너뛴다', () => {
    // 문장 완성은 범주와 무관하게 낱말마다 있으므로, 이 열셋도 2번은 받는다.
    // 예전에는 0 → 3으로 두 칸을 건너뛰었다.
    expect(nextCueLevel('가방', null, CUE_NONE)).toBe(CUE_SENTENCE);
    expect(nextCueLevel('가방', null, CUE_SENTENCE)).toBe(CUE_PHONEMIC);
  });

  it('돌 — 한 글자이면서 범주도 없다', () => {
    // 범주가 없어 1번은 못 받지만 2번은 받는다.
    expect(nextCueLevel('돌', null, CUE_NONE)).toBe(CUE_SENTENCE);
    expect(nextCueLevel('돌', null, CUE_SENTENCE)).toBe(CUE_PHONEMIC);
    expect(cueForLevel('돌', null, CUE_PHONEMIC)?.text).toBe('첫소리는 ㄷ');
    expect(nextCueLevel('돌', null, CUE_PHONEMIC)).toBe(CUE_GIVEN);
  });

  it('끝에서 더 오르지 않는다', () => {
    expect(nextCueLevel('사과', 'food', CUE_GIVEN)).toBe(CUE_GIVEN);
  });
});

describe('번호 체계', () => {
  it('사다리가 0·1·2·3·4로 채워졌다', () => {
    // 2번을 비워 두고 번호를 당기지 않은 덕에, 이미 저장된 cue_level의 뜻이
    // 그대로다 — 예전 행의 3은 지금도 음소 단서다.
    expect(CUE_LADDER).toEqual([0, 1, 2, 3, 4]);
    expect(CUE_SENTENCE).toBe(2);
  });

  it('오름차순이다 — 뒤로 갈수록 도움이 커야 한다', () => {
    // 사다리가 단조롭지 않으면 `cue_level`이 "얼마나 도와야 했나"를 못 뜻하고,
    // 보호자 화면의 "평균 N단계 도움"도 뜻을 잃는다.
    const sorted = [...CUE_LADDER].sort((a, b) => a - b);
    expect(CUE_LADDER).toEqual(sorted);
  });
});

describe('cueForLevel — 문장 완성', () => {
  it('빈칸 앞까지 보여주고, 소리에는 빈칸을 넣지 않는다', () => {
    const cue = cueForLevel('케이크', 'food', CUE_SENTENCE);
    expect(cue?.text).toBe('생일에 초를 꽂는 ___');
    // TTS는 "___"를 읽을 방법이 없다. 말끝을 흐리고 멈추는 것이 신호다.
    expect(cue?.speak).toBe('생일에 초를 꽂는…');
  });

  it('범주가 없는 낱말도 받는다', () => {
    expect(hasCue('우산', null, CUE_SENTENCE)).toBe(true);
    expect(cueForLevel('우산', null, CUE_SENTENCE)?.text).toBe(
      '비 올 때 펴서 쓰는 ___',
    );
  });

  it('낱말 풀 전부에 문구가 있다', () => {
    // 없으면 그 자극만 사다리에서 한 칸이 조용히 사라진다.
    const 없는것 = pickNamingItems(300)
      .filter((i) => !hasCue(i.targetWord, i.category ?? null, CUE_SENTENCE))
      .map((i) => i.targetWord);
    expect([...new Set(없는것)], `문구 없음: ${없는것.join(', ')}`).toEqual([]);
  });

  it('문구에 정답이 들어 있지 않다', () => {
    // 들어 있으면 4단계(통과)와 같아져 사다리가 꼭대기에서 무너진다.
    const 정답유출 = pickNamingItems(300)
      .filter((i) => {
        const cue = cueForLevel(i.targetWord, i.category ?? null, CUE_SENTENCE);
        return cue !== null && cue.text.includes(i.targetWord);
      })
      .map((i) => i.targetWord);
    expect([...new Set(정답유출)], `정답이 샌다: ${정답유출.join(', ')}`).toEqual([]);
  });

  it('완결된 문장으로 끝나지 않는다 — 이을 자리가 있어야 한다', () => {
    // "생일에 초를 꽂아요"처럼 끝나면 뒤를 이을 수 없다.
    //
    // 꾸미는 말의 **허용 목록**을 두려다 그만뒀다. 한국어에서 이름을 앞에서
    // 꾸미는 꼴이 -는/-한만이 아니다 — 실측으로 `보라색`·`산속의`도 나왔고,
    // 목록을 세면 문구를 쓸 때마다 목록을 늘려야 한다. 실제 실패는 "종결어미로
    // 끝나 버리는 것"이므로 그쪽을 막는다.
    for (const item of pickNamingItems(300)) {
      const cue = cueForLevel(item.targetWord, item.category ?? null, CUE_SENTENCE);
      if (cue === null) continue;
      expect(cue.text, item.targetWord).toMatch(/ ___$/);
      expect(cue.speak, item.targetWord).not.toMatch(/[요다까죠네]…$/);
    }
  });
});

describe('실제 자극', () => {
  it('모든 이름대기 문항이 사다리를 끝까지 오른다', () => {
    // 어떤 자극도 "힌트를 눌렀는데 아무것도 안 나오는" 상태가 없어야 한다.
    for (const item of pickNamingItems(200)) {
      const { targetWord: w, category: c } = item;
      let level = CUE_NONE;
      const 밟은칸: number[] = [];
      for (let i = 0; i < 5 && level !== CUE_GIVEN; i += 1) {
        level = nextCueLevel(w, c ?? null, level);
        밟은칸.push(level);
        if (level !== CUE_GIVEN) {
          expect(cueForLevel(w, c ?? null, level), `${w} lv${level}`).not.toBeNull();
        }
      }
      expect(level, w).toBe(CUE_GIVEN);
      expect(밟은칸.length, `${w}: ${밟은칸.join('→')}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('문항이 category를 싣고 온다', () => {
    const items = pickNamingItems(50);
    expect(items.length).toBeGreaterThan(0);
    // 전부 null이면 배선이 끊긴 것이다(예전 상태).
    expect(items.some((i) => i.category != null)).toBe(true);
  });
});
