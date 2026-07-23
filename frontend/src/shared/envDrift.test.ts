import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `.env.example`이 코드와 어긋나는 것을 막는다.
 *
 * 프론트는 아예 .env.example이 없었다. 코드는 7개를 읽고 있었는데
 * (VITE_API_URL, 음성 엔진 스위치 2개, 개발용 자동로그인 4개) 새로 합류한
 * 사람이 알 방법이 없었다.
 *
 * Vite는 VITE_ 접두사가 붙은 값만 번들에 넣고, 번들에 들어간 값은 브라우저
 * 에서 누구나 볼 수 있다. 그래서 여기 목록은 "설정 안내"인 동시에
 * "무엇이 공개되는가" 목록이기도 하다.
 */

const SRC_DIR = join(process.cwd(), 'src');
const ENV_EXAMPLE = join(process.cwd(), '.env.example');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Vite가 정의하는 내장 값. 사용자가 설정하는 게 아니다. */
const BUILTIN = new Set(['DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL']);

function collectUsed(): Set<string> {
  const patterns = [
    /import\.meta\.env\.([A-Z_0-9]+)/g,
    /import\.meta\.env\['([A-Z_0-9]+)'\]/g,
  ];
  const used = new Set<string>();
  for (const file of walk(SRC_DIR)) {
    const source = readFileSync(file, 'utf-8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        if (!BUILTIN.has(match[1])) used.add(match[1]);
      }
    }
  }
  return used;
}

function collectDeclared(): Set<string> {
  return new Set(
    readFileSync(ENV_EXAMPLE, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.split('=')[0].trim()),
  );
}

describe('환경변수 드리프트', () => {
  it('코드가 읽는 환경변수가 모두 .env.example에 있다', () => {
    const missing = [...collectUsed()]
      .filter((name) => !collectDeclared().has(name))
      .sort();

    expect(missing).toEqual([]);
  });

  it('.env.example에 코드가 안 쓰는 값이 없다', () => {
    const used = collectUsed();
    const unused = [...collectDeclared()]
      .filter((name) => !used.has(name))
      .sort();

    expect(unused).toEqual([]);
  });

  it('모든 항목이 VITE_ 접두사를 가진다', () => {
    // 접두사가 없으면 Vite가 번들에 넣지 않아, 설정해도 undefined가 된다.
    const wrong = [...collectDeclared()]
      .filter((name) => !name.startsWith('VITE_'))
      .sort();

    expect(wrong).toEqual([]);
  });
});
