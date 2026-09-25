// 영어 자극은 필요할 때 불러온다 — 로드 전 영어 뽑기는 한국어로 대신하지 않고 터뜨린다.
// 모듈 상태(로드 여부)를 다루므로 다른 테스트와 파일을 나눈다.

import { describe, expect, it } from 'vitest';
import {
  ensureSpeechBank,
  pickRepeatItems,
} from './QabSpeechBank.js';

describe('영어 자극 지연 로드', () => {
  it('한국어는 로드 없이 바로 뽑힌다', () => {
    expect(pickRepeatItems(3, 1).length).toBe(3);
  });

  it('영어를 로드 전에 뽑으면 한국어로 대신하지 않고 던진다', () => {
    expect(() => pickRepeatItems(3, 1, { locale: 'en-US' })).toThrow(
      /ensureSpeechBank/,
    );
  });

  it('ensureSpeechBank 뒤에는 영어 문항이 나오고 id에 로케일 접두가 붙는다', async () => {
    await ensureSpeechBank('en-US');
    const items = pickRepeatItems(3, 1, { locale: 'en-US' });
    expect(items.length).toBe(3);
    expect(items.every((it) => it.itemId.startsWith('en-US:'))).toBe(true);
  });

  it('한국어 로케일로 ensure해도 아무것도 불러오지 않는다', async () => {
    await expect(ensureSpeechBank('ko-KR')).resolves.toBeUndefined();
  });
});
