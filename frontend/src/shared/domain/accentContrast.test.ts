// 테라코타를 잘못 쓴 곳이 없는지 소스에서 직접 확인한다.
//
// `accent`는 **중간 톤**이라 흰색과 2.95:1이다. 어떤 글자 크기에서도
// WCAG 기준(본문 4.5 / 큰 글씨·UI 경계 3.0)을 못 넘는다. 그래서 잉크로 쓰면 안 되고
// 면으로만 써야 한다. 잉크가 필요한 자리는 `accent-strong`(4.54:1)이다.
//
// **이 테스트가 없으면 B안이 무너진다.** 토큰을 둘로 나누는 방식의 유일한 위험이
// "새 코드가 어느 쪽인지 잘못 고르는 것"인데, 그건 조용히 틀리고 화면을 열어보기
// 전까지 아무도 모른다.
//
// 예전에는 이 그물이 `#E07B54` hex를 grep했다. 색이 `@theme` 토큰으로 옮겨간
// 뒤로 소스에 hex가 없으므로 **토큰 이름**을 본다. 이름은 hex보다 나은 그물이다
// — `bg-accent/8`처럼 투명도가 붙어도, 팔레트 값이 바뀌어도 계속 잡는다.
//
// 대비 수치는 팔레트에서 직접 읽는다. 여기 베껴 적으면 index.css를 고쳤을 때
// 조용히 참이 되는 죽은 테스트가 된다.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const CSS = join(SRC, 'index.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(p) && !/\.test\./.test(p)) out.push(p);
  }
  return out;
}

/** 주석 줄인가.
 *
 * 색 규칙을 **설명하는 산문**이 그 규칙을 어길 수는 없다. 이 필터가 없으면
 * "`text-accent`는 쓰지 마라"라고 적은 주석이 스스로 위반으로 잡힌다(실제로
 * 걸렸다). 진짜 위반은 className 안에 있지 주석 줄에 있지 않다. */
const 주석줄 = (line: string): boolean =>
  /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

/** `@theme`에 선언된 토큰 값을 읽는다. */
function 토큰값(이름: string): string | undefined {
  const css = readFileSync(CSS, 'utf8');
  return new RegExp(`--color-${이름}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
}

/** 흰색 대비 명도비. */
function 흰색대비(hex: string): number {
  const 상대휘도 = [1, 3, 5]
    .map((i) => parseInt(hex.substr(i, 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * 상대휘도[0] + 0.7152 * 상대휘도[1] + 0.0722 * 상대휘도[2];
  return 1.05 / (L + 0.05);
}

/** `accent`가 잉크로 쓰인 줄 — 텍스트 색이거나 링, 또는 흰 글씨를 받치는 면.
 *
 * `\b`로 끝을 막는 이유: `accent-strong`·`accent-ink`는 정당한 잉크다.
 * 경계가 없으면 `text-accent-strong`이 `text-accent`에 걸려 오탐이 된다.
 * 투명도 수식(`/8`)은 `\b`가 아니라 별도로 허용한다. */
const 잉크꼬리 = String.raw`accent(?:\/\d+)?\b(?!-)`;
const 잉크로쓴패턴 = [
  new RegExp(String.raw`text-${잉크꼬리}`),
  new RegExp(String.raw`ring-${잉크꼬리}`),
  new RegExp(String.raw`\btext-white\b[^\n]*bg-${잉크꼬리}`),
  new RegExp(String.raw`bg-${잉크꼬리}[^\n]*\btext-white\b`),
];

describe('테라코타 대비', () => {
  const 줄들 = walk(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ file: file.slice(SRC.length + 1), line, no: i + 1 }))
      .filter((x) => !주석줄(x.line))
      .filter((x) => /\baccent\b/.test(x.line)),
  );

  it('검사할 줄이 실제로 있다', () => {
    // 이 파일이 항진명제가 되는 것을 막는다. 토큰 이름이 바뀌면 여기서 걸린다.
    expect(줄들.length).toBeGreaterThan(0);
  });

  it('accent는 흰색 대비가 모자라 잉크로 쓸 수 없는 색이다', () => {
    // 이 테스트가 존재하는 전제 자체를 확인한다. 팔레트에서 accent를 밝히거나
    // 어둡게 바꾸면 아래 규칙의 근거가 달라지므로 여기서 먼저 깨져야 한다.
    const accent = 토큰값('accent');
    expect(accent, 'index.css에 --color-accent가 있어야 한다').toBeTruthy();
    expect(흰색대비(accent as string)).toBeLessThan(3);

    const strong = 토큰값('accent-strong');
    expect(strong, 'index.css에 --color-accent-strong이 있어야 한다').toBeTruthy();
    expect(흰색대비(strong as string)).toBeGreaterThanOrEqual(4.5);
  });

  it('accent를 잉크로 쓰지 않는다', () => {
    // 흰 글씨를 받치거나, 그 자체가 글자·링이면 accent-strong을 써야 한다.
    const 위반 = 줄들
      .filter((x) => 잉크로쓴패턴.some((re) => re.test(x.line)))
      // hover:text-는 기본색이 따로 있고 잉크로 바뀌므로 위 패턴에 잡힌다.
      .map((x) => `${x.file}:${x.no}  ${x.line.trim().slice(0, 70)}`);

    expect(위반, `\n${위반.join('\n')}\n`).toEqual([]);
  });

  it('accent-strong이 실제로 쓰이고 있다', () => {
    // 나누기만 하고 아무 데도 안 쓰면 나눈 의미가 없다.
    const 쓰인곳 = walk(SRC).filter((f) =>
      /\baccent-strong\b/.test(readFileSync(f, 'utf8')),
    );
    expect(쓰인곳.length).toBeGreaterThan(5);
  });

  it('팔레트 밖의 hex가 컴포넌트에 남아 있지 않다', () => {
    // 토큰으로 옮긴 뒤 다시 임의값으로 돌아가는 것을 막는 그물이다.
    // hex가 정당한 곳은 세 군데뿐이다: 팔레트를 정의하는 index.css,
    // 브랜드 규정색(구글·카카오 로그인), 그리고 이름이 없는 일회성 색.
    const 팔레트hex = [
      ...readFileSync(CSS, 'utf8').matchAll(/--color-[\w-]+:\s*(#[0-9a-f]{6})/gi),
    ].map((m) => m[1].toUpperCase());
    expect(팔레트hex.length).toBeGreaterThan(20);

    const 위반 = walk(SRC)
      .filter((f) => f !== CSS)
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ file: file.slice(SRC.length + 1), line, no: i + 1 }))
          // 주석은 실측 근거를 hex로 적는 자리다(예: "#9AA09B는 2.47:1이라 뺐다").
          .filter((x) => !주석줄(x.line))
          .filter((x) =>
            [...x.line.matchAll(/#[0-9a-fA-F]{6}\b/g)].some((m) =>
              팔레트hex.includes(m[0].toUpperCase()),
            ),
          ),
      )
      .map((x) => `${x.file}:${x.no}  ${x.line.trim().slice(0, 70)}`);

    expect(위반, `\n팔레트 색은 토큰으로 쓴다:\n${위반.join('\n')}\n`).toEqual(
      [],
    );
  });
});
