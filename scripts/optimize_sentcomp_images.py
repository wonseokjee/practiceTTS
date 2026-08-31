# -*- coding: utf-8 -*-
"""문장이해 장면 그림을 화면에 필요한 크기로 줄인다.

## 왜

생성 스크립트가 모델이 준 PNG를 그대로 저장한다. 그 결과 2048×2048 5~6MB짜리
그림이 저장소에 쌓였다 — 32장 합쳐 **88MB**. 그런데 화면에서는 2지선다 카드
**202px**로 그린다(`ImageChoiceQuizItem`의 `grid-cols-2`, 모바일 셸 max-w-md).

문항 하나가 그림 두 장이라, sentComp_03은 한 문항에 12.9MB를 내려받는다.
어르신이 병원 대기실 LTE로 여는 앱에서 그건 문항 하나에 십수 초다.

## 얼마로 줄이나

**640px.** 202px 카드를 3배 화면(DPR 3)에서 또렷하게 그리는 데 필요한 606px보다
조금 크다. 그 위는 내려받기만 늘고 화면은 같다.

색은 **128색 팔레트**로 줄인다. 평면 일러스트라 손실이 눈에 안 띈다 —
sentComp_03에서 평균 색차 0.98/255, 나란히 놓고도 구분이 안 됐다.

실측(sentComp_03_correct, 2048px 6,481KB):

    512px 128색   144KB
    640px 128색   226KB   ← 이걸 쓴다
    768px 128색   327KB
   1024px 128색   579KB

## 쓰기

    python scripts/optimize_sentcomp_images.py            # 큰 것만 줄인다
    python scripts/optimize_sentcomp_images.py --check    # 줄일 게 있으면 exit 1
    python scripts/optimize_sentcomp_images.py --only sg_01_correct

이미 목표 크기 이하인 파일은 건드리지 않는다(여러 번 돌려도 안전하다).
새 그림을 생성한 뒤 한 번 돌리면 된다.
"""
import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "frontend" / "public" / "assets" / "images" / "sentComp"

TARGET_PX = 640
COLORS = 128


def optimize(path: Path, dry: bool) -> tuple[int, int]:
    """(전, 후) 바이트. 줄일 필요가 없으면 둘이 같다."""
    from PIL import Image

    before = path.stat().st_size
    img = Image.open(path)
    if img.size[0] <= TARGET_PX and img.size[1] <= TARGET_PX:
        return before, before

    if dry:
        return before, -1

    out = img.convert("RGB").resize((TARGET_PX, TARGET_PX), Image.LANCZOS)
    out.quantize(colors=COLORS, method=Image.MEDIANCUT).save(
        path, "PNG", optimize=True
    )
    return before, path.stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="줄일 게 있으면 exit 1")
    ap.add_argument("--only", default=None, help="이 파일만(확장자 없이)")
    args = ap.parse_args()

    files = sorted(p for p in IMG_DIR.glob("*.png"))
    if args.only:
        files = [p for p in files if p.stem == args.only]
        if not files:
            print("[!] --only %s: 그런 파일이 없다" % args.only)
            return 1

    total_before = total_after = 0
    touched = []
    for path in files:
        before, after = optimize(path, args.check)
        total_before += before
        if args.check:
            if after < 0:
                touched.append(path.name)
                print("[크다] %-28s %6dKB" % (path.name, before // 1024))
            continue
        total_after += after
        if after != before:
            touched.append(path.name)
            print("%-28s %6dKB -> %5dKB" % (path.name, before // 1024, after // 1024))

    if args.check:
        print("검사 %d장 · 줄일 것 %d장" % (len(files), len(touched)))
        return 1 if touched else 0

    print(
        "%d장 중 %d장 줄임 · %.1fMB -> %.1fMB"
        % (
            len(files),
            len(touched),
            total_before / 1024 / 1024,
            total_after / 1024 / 1024,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
