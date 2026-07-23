import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 사진 렌더 규칙을 코드로 강제한다.
 *
 * 두 번의 사고가 이 테스트의 이유다.
 *
 * 1) ISSUE-002 — 상대 경로를 <img src>에 그대로 넣으면 브라우저가 프론트
 *    오리진으로 해석해 사진이 **조용히** 깨졌다(404도 콘솔 에러도 안 남는다).
 *    처음 고칠 때 네 곳을 고치고 두 곳을 놓쳤다.
 * 2) 사진이 인증 없이 서빙되고 있었다. 이제 소유권 확인을 거치므로
 *    Authorization 헤더가 필요한데, <img src>는 헤더를 실을 수 없다.
 *
 * 그래서 현재 규칙은 하나다: **서버 사진은 AuthedImage로만 렌더한다.**
 * 사람 눈으로 훑는 방식이 두 번 실패했으므로 기계가 막는다.
 *
 * 예전 버전은 `src={` 바로 뒤만 검사하는 정규식이라
 * `src={resolveMediaUrl(a) ?? photoUrl}` 같은 형태와 여러 줄로 쓴 <img>를
 * 통과시켰다. 지금은 <img> 태그 전체를 떼어내 검사한다.
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

/** 여러 줄로 작성된 것까지 포함해 <img ...> 태그 하나를 통째로 집는다. */
const IMG_TAG = /<img\b[\s\S]*?\/?>/g;

/** 서버가 내려준 사진 경로를 가리키는 식별자 */
const SERVER_PHOTO_REF = /\bphotoUrl\b/;

describe('사진 렌더 규칙', () => {
  const files = walk(SRC_DIR);

  it('검사할 tsx 파일이 있다', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('서버 사진을 <img>로 직접 렌더하는 곳이 없다 (AuthedImage를 쓸 것)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      for (const tag of source.match(IMG_TAG) ?? []) {
        if (SERVER_PHOTO_REF.test(tag)) {
          offenders.push(`${relative(process.cwd(), file)}: ${tag.slice(0, 60)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('photoUrl에 resolveMediaUrl을 직접 쓰는 곳이 없다 (AuthedImage 내부 담당)', () => {
    // 남아 있으면 인증 없이 URL만 만들어 쓰던 옛 경로가 되살아난 것이다.
    const offenders = files
      .filter((file) =>
        /resolveMediaUrl\([^)]*\bphotoUrl\b/.test(readFileSync(file, 'utf-8')),
      )
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
