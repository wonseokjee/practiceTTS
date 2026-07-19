import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression: ISSUE-002 — 백엔드가 준 상대 경로를 <img src>에 그대로 넣으면
 * 브라우저가 프론트 오리진으로 해석해 사진이 조용히 깨진다(404도 콘솔 에러도
 * 안 남는다). 처음 고칠 때 네 곳을 고쳤는데 두 곳을 놓쳤고, QA 재검에서야
 * 드러났다. 사람 눈으로 훑는 방식이 반복해서 실패하므로 테스트로 막는다.
 * Found by /qa on 2026-07-19
 * Report: .gstack/qa-reports/qa-report-localhost-2026-07-19.md
 */

const SRC_DIR = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 서버가 준 사진 경로를 그대로 src에 넣은 자리를 찾는다.
 * 허용: resolveMediaUrl(...)로 감싼 경우, 로컬 미리보기(photoPreview 등).
 */
const RAW_PHOTO_SRC = /src=\{(?!resolveMediaUrl)[^}]*\bphotoUrl\b[^}]*\}/;

describe('사진 URL 사용 규칙', () => {
  const files = walk(SRC_DIR);

  it('검사할 tsx 파일이 있다', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('photoUrl을 resolveMediaUrl 없이 <img src>에 넣은 곳이 없다', () => {
    const offenders = files
      .filter((file) => RAW_PHOTO_SRC.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
