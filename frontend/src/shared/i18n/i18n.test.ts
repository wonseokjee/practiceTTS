// i18n 기반(Phase 1-1) — 규약이 코드로 지켜지는지
//
// 검증 포인트:
//  - 그릴 수 없는 로케일은 기본(ko-KR)으로
//  - 지연 로딩: 활성 로케일의 리소스만 받는다
//  - 복수형 규약: count + _one/_other, 한국어는 _other만
//  - 폴백 끔: 영어에 없는 키가 한국어로 새지 않는다(§7-7 결정 A)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVAILABLE_LOCALES, i18n, initI18n, resolveUiLocale } from './i18n.js';

describe('i18n 기반 (Phase 1-1)', () => {
  afterEach(() => {
    for (const lng of ['ko-KR', 'en-US']) {
      if (i18n.hasResourceBundle(lng, 'test')) {
        i18n.removeResourceBundle(lng, 'test');
      }
    }
    vi.restoreAllMocks();
  });

  it('리소스 파일이 있는 로케일만 그린다 — 나머지는 ko-KR', () => {
    expect(AVAILABLE_LOCALES).toEqual(
      expect.arrayContaining(['ko-KR', 'en-US']),
    );
    expect(resolveUiLocale('en-US')).toBe('en-US');
    expect(resolveUiLocale('fr-FR')).toBe('ko-KR');
    expect(resolveUiLocale('ko')).toBe('ko-KR'); // 로케일 단위로만 맞춘다
    expect(resolveUiLocale(null)).toBe('ko-KR');
    expect(resolveUiLocale(undefined)).toBe('ko-KR');
  });

  it('초기화는 활성 로케일의 리소스만 받는다 — 영어는 안 받는다(지연 로딩)', async () => {
    await initI18n('ko-KR');

    expect(i18n.language).toBe('ko-KR');
    expect(i18n.hasResourceBundle('ko-KR', 'common')).toBe(true);
    expect(i18n.hasResourceBundle('en-US', 'common')).toBe(false);
  });

  it('복수형 규약 — count로 보간, 한국어는 _other 하나로 모든 수를 받는다', async () => {
    await initI18n();
    i18n.addResourceBundle('ko-KR', 'test', { sessions_other: '{{count}}회' });
    i18n.addResourceBundle('en-US', 'test', {
      sessions_one: '{{count}} session',
      sessions_other: '{{count}} sessions',
    });
    const ko = i18n.getFixedT('ko-KR', 'test');
    const en = i18n.getFixedT('en-US', 'test');

    expect(ko('sessions', { count: 1 })).toBe('1회');
    expect(ko('sessions', { count: 3 })).toBe('3회');
    expect(en('sessions', { count: 1 })).toBe('1 session');
    expect(en('sessions', { count: 3 })).toBe('3 sessions');
  });

  it('영어에 없는 키는 한국어로 새지 않는다 — 빠진 키는 경고로 드러난다', async () => {
    await initI18n();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    i18n.addResourceBundle('ko-KR', 'test', { onlyKo: '따라 말해 보세요' });

    const shown = i18n.getFixedT('en-US', 'test')('onlyKo');

    expect(shown).not.toBe('따라 말해 보세요');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('test:onlyKo'));
  });
});
