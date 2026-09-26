// 이름대기 이웃 목록이 앱이 실제로 내는 이름대기 낱말과 어긋나지 않게 한다.
//
// 이 목록은 이웃 비교 채점의 입력이다(docs/history/20260926_NeighborScoring_*).
// 낱말을 풀에 추가하거나 사진을 넣고 목록을 다시 안 만들면, 그 낱말은 이웃 없이 채점된다
// (v1로 떨어진다). 조용한 회귀라 여기서 잡는다 — WORD_CATEGORY에 범주를 넣고 소비자
// 문구를 빠뜨린 사고와 같은 종류다.
//
// 어긋남은 두 방향이다.
//   이름대기에 나오는데 목록에 없다  → 그 낱말만 이웃 비교 없이 채점된다
//   목록에 있는데 이름대기에 안 나온다 → 낡은 항목(낱말을 뺐는데 목록이 그대로)
//
// 다시 만드는 법: python scripts/build_neighbor_manifest.py

import { describe, expect, it } from 'vitest';
import manifest from './neighborManifest.ko-KR.json';
import pool from './qabWordPool.json';
import namingOnly from './namingOnlyWords.json';
import speechStimuli from './qabSpeechStimuli.json';
import { pickNamingItems } from '../../memory-link/patient/quiz/infrastructure/QabItemBank.js';

const neighbors = manifest.neighbors as Record<string, string[]>;

/** 앱이 이름대기에 낼 수 있는 낱말 전부(요청 개수를 풀보다 크게 준다). */
function allNamingWords(): string[] {
  return [...new Set(pickNamingItems(10_000).map((it) => it.targetWord))].sort();
}

describe('neighborManifest.ko-KR', () => {
  it('머리말: ko-KR · 이름대기 범위 · 이웃 3개', () => {
    expect(manifest.locale).toBe('ko-KR');
    expect(manifest.scope).toBe('naming');
    expect(manifest.k).toBe(3);
  });

  it('이름대기에 나올 수 있는 낱말마다 목록이 있다', () => {
    const 없는것 = allNamingWords().filter((w) => !(w in neighbors));
    expect(
      없는것,
      `이웃 목록에 없는 이름대기 낱말: ${없는것.join(', ')} — python scripts/build_neighbor_manifest.py`,
    ).toEqual([]);
  });

  it('목록의 낱말은 모두 이름대기에 나올 수 있다(낡은 항목 없음)', () => {
    const 나오는것 = new Set(allNamingWords());
    const 낡은것 = Object.keys(neighbors).filter((w) => !나오는것.has(w));
    expect(
      낡은것,
      `이름대기에 없는 낱말이 목록에 남아 있다: ${낡은것.join(', ')}`,
    ).toEqual([]);
  });

  it('낱말마다 서로 다른 이웃이 정확히 k개이고 자신·포함관계가 아니다', () => {
    for (const [w, ns] of Object.entries(neighbors)) {
      expect(ns, w).toHaveLength(manifest.k);
      expect(new Set(ns).size, w).toBe(ns.length);
      for (const n of ns) {
        expect(n, `${w}의 이웃`).not.toBe(w);
        expect(n.includes(w) || w.includes(n), `${w}↔${n} 포함관계`).toBe(false);
      }
    }
  });

  it('이웃은 전부 앱이 가진 낱말이다(낱말 풀·이름대기 전용·따라말하기 낱말)', () => {
    // 이웃 후보의 출처는 이 셋이다(scripts/asr_eval/neighbor_manifest.py load_app_vocab).
    // 목록이 앱 밖 단어를 이웃으로 삼으면 그 단어를 환자가 말해도 앱은 모르는 단어로 본다.
    const 앱낱말 = new Set([
      ...pool.items.map((it) => it.targetWord.trim()),
      ...namingOnly.items.map((w) => w.label.trim()),
      ...speechStimuli.repeatWords.map((w) => w.trim()),
    ]);
    const 밖 = Object.entries(neighbors).flatMap(([w, ns]) =>
      ns.filter((n) => !앱낱말.has(n)).map((n) => `${w}→${n}`),
    );
    expect(밖, `앱에 없는 낱말을 이웃으로 삼았다: ${밖.join(', ')}`).toEqual([]);
  });

  it('고정 사례: 실측에 쓴 이웃과 같다(사탕·가위)', () => {
    expect(neighbors['사탕']).toEqual(['사자', '낙타', '수달']);
    expect(neighbors['가위']).toEqual(['거위', '바위', '가재']);
  });
});
