import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 서버 예외에 한국어 문장을 직접 넣는 곳을 **늘리지 못하게** 하는 래칫(영어판 §17 D6).
 *
 * 영어 보호자에게 서버의 한국어 message가 그대로 보인다. 새 예외는 오류 코드 계약
 * (`common/error-codes.ts`의 `{ code, message }`)으로 던져야 한다. 기존 부채는
 * `korean-exception-baseline.json`에 파일별 개수로 고정했고, 코드 계약으로 옮기면 그
 * 파일 개수를 **줄여서** 갱신한다(늘리는 방향의 갱신은 리뷰에서 막는다).
 */
const SRC = join(__dirname, '..');
const HANGUL = /[가-힣]/;
/** `new XxxException('…')` 의 첫 문자열 인자. 코드 계약(`AUTH_ERRORS.X`)은 문자열이 아니라 안 걸린다. */
const KOREAN_EXCEPTION = /Exception\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

function countByFile(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf-8');
    let n = 0;
    for (const m of text.matchAll(KOREAN_EXCEPTION)) {
      if (HANGUL.test(m[2])) n += 1;
    }
    if (n > 0) counts[relative(SRC, file).replace(/\\/g, '/')] = n;
  }
  return counts;
}

describe('한국어 예외 메시지 래칫', () => {
  const base = JSON.parse(
    readFileSync(join(__dirname, 'korean-exception-baseline.json'), 'utf-8'),
  ) as Record<string, number>;
  const now = countByFile();

  it('새 파일이 한국어 예외 문자열을 들이지 않는다', () => {
    const added = Object.keys(now).filter((f) => !(f in base));
    expect(added).toEqual([]);
  });

  it('기존 파일도 한국어 예외 문자열을 늘리지 않는다', () => {
    const grown = Object.entries(now)
      .filter(([f, n]) => f in base && n > base[f])
      .map(([f, n]) => `${f}: ${base[f]} → ${n}`);
    expect(grown).toEqual([]);
  });

  it('줄였으면 기준선도 줄인다 — 오래된 기준선이 여유를 남기지 않게', () => {
    const stale = Object.entries(base)
      .filter(([f, n]) => (now[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${n} → ${now[f] ?? 0}`);
    expect(stale).toEqual([]);
  });
});
