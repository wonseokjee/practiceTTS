// 영어 발화 자극(en-US) — 저작 규칙을 코드로 고정한다.
//
// 설계: docs/history/20260913_EnglishSpeechContent_design.md §4·§5.
// 밴드 크기(116)는 마지막 배치에서 건다 — 한국어판도 콘텐츠가 다 찬 뒤에
// 상수를 올렸다(QabSpeechBank.test.ts의 최소밴드). 여기는 **어느 배치에서나
// 항상 참이어야 하는 것**만 본다.

import { describe, expect, it } from 'vitest';
import stimuli from './qabSpeechStimuli.en-US.json';
import { syllablesOf } from '../../../scripts/en-syllables.mjs';

interface Item {
  text: string;
  syllables: number;
}

const repeatWords = stimuli.repeatWords as Item[];
const repeatSentences = stimuli.repeatSentences as Item[];
const readingSentences = stimuli.readingSentences as Item[];
const all: Item[] = [...repeatWords, ...repeatSentences, ...readingSentences];

/**
 * 채점 기준이 en-US 참조 발음 **하나**라서, 발음이 둘로 갈리는 말은 누가 말해도
 * 한쪽이 틀린다. 설계 §5 규칙 4.
 */
const FORBIDDEN = [
  // 동형이의어 — 철자 하나에 발음 둘
  'read', 'live', 'lead', 'wind', 'tear', 'bow', 'close', 'bass', 'dove', 'row',
  'minute', 'object', 'present', 'record', 'desert', 'produce', 'wound',
  // 지역차가 큰 말
  'caramel', 'pecan', 'route', 'roof', 'creek', 'aunt', 'tomato', 'either',
  // 음절 수가 사람마다 흔들리는 말 — 밴드가 흔들린다
  'fire', 'hour', 'flower', 'tire', 'power', 'our', 'iron', 'orange', 'towel',
  'family', 'chocolate', 'camera', 'broccoli', 'library', 'vegetable', 'every',
];

describe('영어 발화 자극 (en-US)', () => {
  it('로케일이 박혀 있다', () => {
    expect(stimuli.locale).toBe('en-US');
  });

  it('음절 필드가 CMUdict와 같다 — 손으로 고친 값이 섞이지 않는다', () => {
    for (const it of all) {
      const { syllables, oov } = syllablesOf(it.text);
      expect(oov, `${it.text}: 사전에 없는 말`).toEqual([]);
      expect(it.syllables, it.text).toBe(syllables);
    }
  });

  it('숫자·하이픈이 없다 — 단어 수를 세는 방식이 모호해지지 않게', () => {
    for (const it of all) expect(it.text, it.text).not.toMatch(/[0-9-]/);
  });

  it('낱말은 소문자 한 단어다 — 고유명사가 끼어들 틈이 없다', () => {
    for (const it of repeatWords) expect(it.text, it.text).toMatch(/^[a-z]+$/);
  });

  it('문장은 첫 글자만 대문자이고 끝 문장부호가 없다(한국어 자극과 같게)', () => {
    for (const it of [...repeatSentences, ...readingSentences]) {
      expect(it.text, it.text).toMatch(/^[A-Z]/);
      // 대명사 I는 늘 대문자다 — 고유명사 휴리스틱에서 뺀다.
      expect(
        it.text.slice(1).replace(/\bI\b/g, ''),
        `${it.text}: 가운데 대문자 — 고유명사?`,
      ).not.toMatch(/\b[A-Z]/);
      expect(it.text, it.text).not.toMatch(/[.!?]$/);
    }
  });

  it('통 안에서 중복이 없다', () => {
    for (const [name, list] of [
      ['repeatWords', repeatWords],
      ['repeatSentences', repeatSentences],
      ['readingSentences', readingSentences],
    ] as const) {
      const texts = list.map((i) => i.text);
      expect(new Set(texts).size, name).toBe(texts.length);
    }
  });

  it('읽기와 따라말하기는 한 문장도 겹치지 않는다 — 읽어 본 문장이 따라말하기 점수에 섞인다', () => {
    const reading = new Set(readingSentences.map((i) => i.text));
    const both = repeatSentences.filter((i) => reading.has(i.text));
    expect(both.map((i) => i.text)).toEqual([]);
  });

  it('DDK는 puh·tuh·kuh로만, 밴드(음절 1·2·3)마다 3개씩', () => {
    // 음향 포락선으로 반복을 세므로(ddkScore) 채점은 언어와 무관하다 — 자극만 옮긴다.
    const ddk = stimuli.ddk;
    const perBand = new Map<number, number>();
    for (const d of ddk) {
      const parts = d.label.split('-');
      for (const p of parts) expect(['puh', 'tuh', 'kuh'], d.label).toContain(p);
      expect(d.syllable, d.label).toBe(parts.join(''));
      perBand.set(parts.length, (perBand.get(parts.length) ?? 0) + 1);
    }
    expect(Object.fromEntries(perBand)).toEqual({ 1: 3, 2: 3, 3: 3 });
    expect(new Set(ddk.map((d) => d.label)).size).toBe(ddk.length);
  });

  it('발음이 갈리는 말을 쓰지 않는다', () => {
    const banned = new Set(FORBIDDEN);
    for (const it of all) {
      const tokens = it.text.toLowerCase().split(/\s+/);
      const hit = tokens.filter((t) => banned.has(t));
      expect(hit, it.text).toEqual([]);
    }
  });
});
