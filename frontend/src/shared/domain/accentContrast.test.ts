// 테라코타를 잘못 쓴 곳이 없는지 소스에서 직접 확인한다.
//
// `--accent`(#E07B54)는 **중간 톤**이라 흰색과 2.95:1이다. 어떤 글자 크기에서도
// WCAG 기준(본문 4.5 / 큰 글씨·UI 경계 3.0)을 못 넘는다. 그래서 잉크로 쓰면 안 되고
// 면으로만 써야 한다. 잉크가 필요한 자리는 `--accent-strong`(#B85C36, 4.54:1)이다.
//
// **이 테스트가 없으면 B안이 무너진다.** 토큰을 둘로 나누는 방식의 유일한 위험이
// "새 코드가 어느 쪽인지 잘못 고르는 것"인데, 그건 조용히 틀리고 화면을 열어보기
// 전까지 아무도 모른다.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ACCENT = '#E07B54';
const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(p) && !/\.test\./.test(p)) out.push(p);
  }
  return out;
}

/** `#E07B54`가 잉크로 쓰인 줄 — 텍스트 색이거나 링. */
const 잉크로쓴패턴 = [
  /text-\[#E07B54\]/,
  /ring-\[#E07B54\]/,
  /\btext-white\b[^\n]*bg-\[#E07B54\]/,
  /bg-\[#E07B54\][^\n]*\btext-white\b/,
];

describe('테라코타 대비', () => {
  const 줄들 = walk(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ file: file.slice(SRC.length + 1), line, no: i + 1 }))
      .filter((x) => x.line.includes(ACCENT)),
  );

  it('검사할 줄이 실제로 있다', () => {
    // 이 파일이 항진명제가 되는 것을 막는다. 색 이름이 바뀌면 여기서 걸린다.
    expect(줄들.length).toBeGreaterThan(0);
  });

  it('--accent를 잉크로 쓰지 않는다 (흰색 대비 2.95:1)', () => {
    // 흰 글씨를 받치거나, 그 자체가 글자·링이면 --accent-strong을 써야 한다.
    const 위반 = 줄들
      .filter((x) => 잉크로쓴패턴.some((re) => re.test(x.line)))
      // hover:text-는 기본색이 따로 있고 잉크로 바뀌므로 위 패턴에 잡힌다.
      .map((x) => `${x.file}:${x.no}  ${x.line.trim().slice(0, 70)}`);

    expect(위반, `\n${위반.join('\n')}\n`).toEqual([]);
  });

  it('--accent-strong이 실제로 쓰이고 있다', () => {
    // 나누기만 하고 아무 데도 안 쓰면 나눈 의미가 없다.
    const 쓰인곳 = walk(SRC).filter((f) =>
      readFileSync(f, 'utf8').includes('#B85C36'),
    );
    expect(쓰인곳.length).toBeGreaterThan(5);
  });
});
