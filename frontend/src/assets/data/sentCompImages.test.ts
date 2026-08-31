// 문장이해 장면 그림이 다시 무거워지지 않게 한다.
//
// 생성 스크립트가 모델이 준 PNG를 그대로 저장한 탓에 2048×2048 5~6MB짜리가
// 쌓여 32장 합계 98MB였다. 화면에서는 2지선다 카드 **202px**로 그린다.
// 문항 하나가 그림 두 장이라 sentComp_03은 한 문항에 12.9MB를 내려받았다.
//
// 사람이 기억할 일이 아니다. 그림을 새로 생성하면 또 커지므로 여기서 막는다.
// 줄이는 것은 `scripts/optimize_sentcomp_images.py`가 한다.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'public/assets/images/sentComp');

/** 202px 카드를 3배 화면에서 또렷하게 그리는 데 606px이면 된다. */
const MAX_PX = 640;
/** 640px·128색으로 줄인 실측 최대가 268KB다. */
const MAX_BYTES = 300_000;

/**
 * 예산 밖에 두는 그림 — **비어 있어야 한다.**
 *
 * 한때 다섯 장이 여기 있었다. 열려 있는 PR이 같은 파일을 다시 그리는 중이라
 * 여기서 건드리면 이진 파일이 충돌했기 때문이다. 그 PR들(#104·#105·#109)이
 * 먼저 머지되면서 다섯 장이 다 640px가 됐고, 목록은 비었다.
 *
 * 다시 채워야 할 일이 생기면 이유와 만료 조건을 함께 적는다. 아래 "면제가
 * 아직 필요한가"가 만료를 알려준다 — 예산 안에 드는 파일이 목록에 남아 있으면
 * 실패한다.
 */
const 면제: readonly string[] = [];

/** PNG 헤더에서 폭·높이를 읽는다(IHDR은 늘 16바이트째부터다). */
function 크기(file: string): { w: number; h: number } {
  const buf = readFileSync(join(DIR, file));
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const 전체 = readdirSync(DIR).filter((f) => f.endsWith('.png'));
const 검사대상 = 전체.filter((f) => !면제.includes(f));

describe('sentComp 장면 그림', () => {
  it('화면에 필요한 크기를 넘지 않는다', () => {
    const 큰것 = 검사대상
      .filter((f) => {
        const { w, h } = 크기(f);
        return w > MAX_PX || h > MAX_PX;
      })
      .map((f) => `${f}(${크기(f).w}px)`);
    expect(큰것, `${MAX_PX}px 초과: ${큰것.join(', ')}`).toEqual([]);
  });

  it('한 장이 300KB를 넘지 않는다', () => {
    // 문항 하나가 두 장이라, 여기가 곧 문항당 내려받기의 절반이다.
    const 무거운것 = 검사대상
      .filter((f) => statSync(join(DIR, f)).size > MAX_BYTES)
      .map((f) => `${f}(${Math.round(statSync(join(DIR, f)).size / 1024)}KB)`);
    expect(무거운것, `${MAX_BYTES / 1000}KB 초과: ${무거운것.join(', ')}`).toEqual([]);
  });

  it('면제가 아직 필요한가', () => {
    // 면제는 썩는다. 해당 PR이 머지돼 파일이 이미 예산 안에 들면, 목록에 남은
    // 줄이 다음 사람에게 거짓말을 한다 — "이건 아직 크다"고.
    const 이제필요없음 = 면제.filter((f) => {
      if (!전체.includes(f)) return false;
      const { w, h } = 크기(f);
      return w <= MAX_PX && h <= MAX_PX && statSync(join(DIR, f)).size <= MAX_BYTES;
    });
    expect(
      이제필요없음,
      `예산 안에 드는데 면제 목록에 남아 있다. 목록에서 지워라: ${이제필요없음.join(', ')}`,
    ).toEqual([]);
  });

  it('면제 목록에 없는 파일 이름이 없다', () => {
    // 파일 이름이 바뀌면 면제가 조용히 아무것도 안 막는 줄이 된다.
    const 없는것 = 면제.filter((f) => !전체.includes(f));
    expect(없는것, `그런 파일이 없다: ${없는것.join(', ')}`).toEqual([]);
  });
});
