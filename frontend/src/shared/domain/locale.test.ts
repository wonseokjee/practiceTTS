import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, languageOf } from './locale';

/**
 * 로케일 **단일 출처**를 지킨다.
 *
 * 예전에는 `'ko-KR'`이 STT·TTS·발화 캡처 여섯 곳에 각자 기본 인자로 박혀 있었다.
 * 값이 같아 아무 문제도 없어 보이지만, 언어를 늘릴 때 **여섯 군데를 다 찾아야**
 * 하고 하나만 빠뜨리면 그 경로만 조용히 한국어로 남는다. 그리고 빠뜨렸다는
 * 신호가 어디에도 안 뜬다 — 화면은 멀쩡히 돌고 그 문항만 한국어로 읽힌다.
 *
 * 그래서 "한 곳에서 내려온다"를 주석이 아니라 **검사로** 못 박는다. 일곱 번째가
 * 생기면 여기서 깨진다.
 *
 * `envDrift.test.ts`와 같은 계열의 검사다(코드와 선언이 어긋나는 것을 막는다).
 */

const SRC_DIR = join(process.cwd(), 'src');

/** 이 파일들만 로케일 문자열을 직접 가져도 된다. */
const ALLOWED = [
  join('shared', 'domain', 'locale.ts'),
  join('shared', 'domain', 'locale.test.ts'),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('로케일 단일 출처', () => {
  it('언어 코드를 뽑아낸다', () => {
    expect(languageOf('ko-KR')).toBe('ko');
    expect(languageOf('en-US')).toBe('en');
    expect(languageOf('ko')).toBe('ko');
  });

  it('기본값은 한국어다 — 지금 동작을 바꾸지 않는다', () => {
    expect(DEFAULT_LOCALE).toBe('ko-KR');
  });

  it('앱 코드에 로케일 문자열이 직접 박힌 곳이 없다', () => {
    // 테스트 파일은 로케일을 직접 써도 된다 — 그게 검증 대상이다.
    const offenders = walk(SRC_DIR)
      .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => !ALLOWED.some((a) => f.endsWith(a)))
      .filter((f) => /['"`]ko-KR['"`]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC_DIR.length + 1));

    expect(offenders).toEqual([]);
  });

  it('날짜를 로케일 상수로 직접 찍는 곳이 없다 — formatDate를 거친다', () => {
    // `toLocaleDateString(<상수>)`는 계정 로케일을 우회한다. 화면 날짜는
    // 현재 화면 로케일(LocaleSync)을 따르는 `formatDate`로만 적는다.
    const offenders = walk(SRC_DIR)
      .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) =>
        /toLocale(Date)?String\(\s*[A-Z_]+_LOCALE/.test(readFileSync(f, 'utf8')),
      )
      .map((f) => f.slice(SRC_DIR.length + 1));

    expect(offenders).toEqual([]);
  });
});
