import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 모든 입력 요소가 접근 가능한 이름을 갖는지 검사한다.
 *
 * 배경: 훈련 목표 단어 입력이 placeholder만 갖고 있어, 접근성 트리에
 * "예: 바다 (입력 후 추가)"로 노출됐다.
 *
 * placeholder는 이름이 될 수 없다. **입력을 시작하면 사라지기 때문**이다.
 * 스크린리더 사용자가 중간에 포커스를 잃으면 이 필드가 무엇인지 알 방법이
 * 없다. 고령 사용자와 보조기기 사용자를 전제한 앱이라 더 중요하다.
 *
 * 허용하는 이름 출처는 셋이다:
 *   - aria-label
 *   - aria-labelledby
 *   - <label>로 감싸거나 htmlFor로 연결
 */

const SRC_DIR = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 여는 태그를 중괄호 균형으로 끝까지 읽는다.
 *
 * 단순히 다음 `>`까지 자르면 `onChange={(e) => ...}` 같은 화살표 함수에서
 * 잘려 뒤쪽 속성(aria-label 등)을 놓친다. 실제로 그렇게 잘못 세어
 * 11곳이 문제인 줄 알았는데 실제로는 1곳이었다.
 */
function readOpenTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** 이 태그가 <label>로 감싸여 있는가 (여는 label 이후 닫히지 않았는가). */
function isWrappedInLabel(source: string, tagStart: number): boolean {
  const before = source.slice(0, tagStart);
  const opens = (before.match(/<label\b/g) ?? []).length;
  const closes = (before.match(/<\/label>/g) ?? []).length;
  return opens > closes;
}

describe('입력 요소 접근성 이름', () => {
  it('placeholder만으로 이름을 대신하는 입력이 없다', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_DIR)) {
      const source = readFileSync(file, 'utf-8');
      const linkedIds = new Set(
        [...source.matchAll(/htmlFor=["'{]([A-Za-z0-9_-]+)/g)].map((m) => m[1]),
      );

      for (const match of source.matchAll(/<(input|textarea|select)\b/g)) {
        const start = match.index;
        const tag = readOpenTag(source, start);

        // 사용자가 값을 넣지 않는 입력은 이름이 필요 없다.
        if (/type=["'](hidden|submit|button)["']/.test(tag)) continue;
        if (/aria-label/.test(tag)) continue;

        const idMatch = tag.match(/\bid=["']([A-Za-z0-9_-]+)/);
        if (idMatch && linkedIds.has(idMatch[1])) continue;
        if (isWrappedInLabel(source, start)) continue;

        const line = source.slice(0, start).split('\n').length;
        offenders.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
