// 이름대기 사진 목록이 실제 파일·낱말과 어긋나지 않게 한다.
//
// 이 목록은 **화면 분기의 근거**다. slug가 여기 있으면 실물 사진을 쓰고,
// 없으면 SVG 아이콘으로 떨어진다(`toNamingItem`). 그래서 목록과 파일이
// 어긋나면 조용히 깨진 이미지가 뜨거나, 있는 사진을 안 쓰게 된다.
//
// 둘은 다른 방향의 사고다.
//   목록에 있는데 파일이 없다  → 환자 화면에 깨진 이미지
//   파일이 있는데 목록에 없다  → 만들어 놓고 안 쓴다

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import photos from './namingPhotos.json';
import credits from '../../../public/assets/images/naming/_credits.json';
import pool from './qabWordPool.json';

const DIR = join(process.cwd(), 'public/assets/images/naming');

/** 낱말 풀에서 정답 그림의 slug를 뽑는다(뱅크의 slugFromUrl과 같은 규칙). */
function slugOf(item: { choices: { imageUrl: string; isCorrect: boolean }[] }) {
  const correct = item.choices.find((c) => c.isCorrect)!;
  return correct.imageUrl.split('/').pop()!.replace(/\.[^.]+$/, '');
}

describe('namingPhotos', () => {
  it('목록의 slug마다 실제 파일이 있다', () => {
    const 없는것 = photos.slugs.filter(
      (s) => !existsSync(join(DIR, `${s}.png`)),
    );
    expect(없는것, `파일 없음: ${없는것.join(', ')}`).toEqual([]);
  });

  it('폴더의 파일이 모두 목록에 있다', () => {
    const 파일 = readdirSync(DIR)
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace(/\.png$/, ''));
    const 목록 = new Set(photos.slugs);
    const 빠진것 = 파일.filter((s) => !목록.has(s));
    expect(빠진것, `목록에 없음: ${빠진것.join(', ')}`).toEqual([]);
  });

  it('모든 사진이 300×300이다', () => {
    // 이름대기는 한 장만 단독으로 뜬다. 크기가 제각각이면 문항마다 그림이
    // 커졌다 작아졌다 한다.
    const 큰것 = readdirSync(DIR)
      .filter((f) => f.endsWith('.png'))
      // 300×300 PNG는 대체로 300KB 아래다. 원본을 그대로 넣으면 여기서 걸린다.
      .filter((f) => statSync(join(DIR, f)).size > 400_000);
    expect(큰것, `너무 큼(원본 그대로?): ${큰것.join(', ')}`).toEqual([]);
  });

  it('낱말 풀에 없는 slug를 들고 있지 않다', () => {
    // 이름대기 전용 낱말 4개(빗·책상·수건·냉장고)는 풀 밖이므로 예외로 둔다.
    const NAMING_ONLY = ['comb', 'desk', 'towel', 'refrigerator'];
    const 풀 = new Set(pool.items.map(slugOf));
    const 낯선것 = photos.slugs.filter(
      (s) => !풀.has(s) && !NAMING_ONLY.includes(s),
    );
    expect(낯선것, `풀에 없는 slug: ${낯선것.join(', ')}`).toEqual([]);
  });

  it('사진마다 출처 기록이 있다', () => {
    const 기록 = new Set(credits.map((c) => c.slug));
    const 없는것 = photos.slugs.filter((s) => !기록.has(s));
    expect(없는것, `_credits.json에 없음: ${없는것.join(', ')}`).toEqual([]);
  });
});
