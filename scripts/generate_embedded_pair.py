# -*- coding: utf-8 -*-
"""내포절(embedded-clause) 장면 **한 쌍**을 그린다.

## 왜 따로 있나

가역문은 두 그림이 **역할**만 다르다. 내포절은 다르다 — 사람도 자세도 같고
**생각 풍선 속만** 다르다. "엄마는 아이가 자고 있다고 생각해요"와 "…놀고
있다고 생각해요"가 같은 엄마 그림에 다른 풍선을 단다.

그래서 공용 스타일을 못 쓴다. `redraw_sentcomp_pair.py`의 STYLE은 말풍선을
금지한다("no speech bubbles") — 가역문에는 맞는 규칙이지만 여기서는 풍선이
자극 그 자체다. 대신 **글자 금지**는 그대로 지킨다: 풍선 안에는 그림만 있고
글자가 없어야 한다(글자를 읽어 맞히면 문장이해 검사가 아니다).

## 순서

1. `correct`를 참조 없이 그린다.
2. `distractor`를 1번 결과를 참조로 그린다 — **풍선 속만** 바꾸라고 시킨다.

가역문의 "드문 방향을 먼저" 규칙은 여기 해당 없다. 역할을 뒤집는 게 아니라
풍선 내용만 갈아 끼우는 것이라 모델이 맞설 선입견이 없다.

## 쓰기

    python scripts/generate_embedded_pair.py --only se_10
    python scripts/generate_embedded_pair.py            # 이미지 없는 것 전부
    python scripts/generate_embedded_pair.py --dry-run  # 프롬프트만
"""
from __future__ import annotations
import argparse, io, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "scripts" / "embedded_image_spec.json"
IMG = ROOT / "frontend" / "public" / "assets" / "images" / "sentComp"
MODEL = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")

STYLE = (
    "Children's picture-book illustration, simple flat colors, thick clean black "
    "outlines, plain solid white background. No text, no letters, no numbers, no "
    "labels anywhere - including inside the thought bubble. Friendly and gentle, "
    "suitable for elderly stroke-recovery patients. "
    "COMPOSITION: one THINKER stands on the left. A large cloud-shaped THOUGHT "
    "BUBBLE (round puffy cloud with two small trailing circles) fills the right "
    "side, and inside it a small scene is drawn. The thought bubble must be "
    "clearly a thought cloud, not a speech balloon."
)
PAIR = (
    "The attached image is the OTHER option of the same two-choice question. "
    "Match it exactly: same thinker, same face, same hair, same clothing colors, "
    "same pose, same art style, same line weight, same framing, same thought "
    "bubble shape, size and position. Change ONLY the small scene drawn INSIDE "
    "the thought bubble."
)


def resolve_api_key() -> tuple[str, str]:
    """환경변수 → 이 트리 → 주 저장소 순. (워크트리에서도 돌아야 한다.)"""
    v = os.getenv("GEMINI_API_KEY", "").strip()
    if v:
        return v, "환경변수"
    for base in (ROOT, _main_repo()):
        if base is None:
            continue
        p = base / "ai-service" / ".env"
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                k, _, val = line.strip().partition("=")
                if k.strip() == "GEMINI_API_KEY" and val.strip():
                    return val.strip(), str(p)
    return "", ""


def _main_repo() -> Path | None:
    g = ROOT / ".git"
    if g.is_file():
        head = g.read_text(encoding="utf-8").strip()
        if head.startswith("gitdir:"):
            return Path(head.split(":", 1)[1].strip()).resolve().parents[2]
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="이 itemId만")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="이미 있어도 다시 그린다")
    args = ap.parse_args()

    items = json.loads(SPEC.read_text(encoding="utf-8"))["items"]
    if args.only:
        items = [x for x in items if x["itemId"] == args.only]
        if not items:
            print(f"[!] --only {args.only}: 스펙에 없음")
            return 1

    client = None
    if not args.dry_run:
        key, src = resolve_api_key()
        if not key or key.lower().startswith("your_"):
            print("[!] GEMINI_API_KEY를 못 찾았습니다.")
            return 1
        from google import genai

        client = genai.Client(api_key=key)
        print(f"[i] 키 출처: {src} · 모델: {MODEL}")

    IMG.mkdir(parents=True, exist_ok=True)
    fail = 0
    for it in items:
        iid = it["itemId"]
        thinker = it["thinker"]
        prompts = {
            "correct": f"{STYLE}\n\nScene to draw: The thinker is {thinker}. "
                       f"Inside the thought bubble: {it['correct']['bubble']}",
            "distractor": f"{STYLE}\n\n{PAIR}\n\nScene to draw: The thinker is {thinker}. "
                          f"Inside the thought bubble: {it['distractor']['bubble']}",
        }
        if args.dry_run:
            for kind, p in prompts.items():
                print(f"=== {iid}_{kind} ===\n{p}\n")
            continue

        ref = None
        for kind in ("correct", "distractor"):
            out = IMG / f"{iid}_{kind}.png"
            if out.exists() and not args.force:
                print(f"[skip] {out.name}")
                if kind == "correct":
                    ref = out
                continue
            parts: list = [prompts[kind]]
            # distractor는 correct를 참조로 넣어 사람·풍선 모양을 고정한다.
            if kind == "distractor" and ref is not None:
                from google.genai import types

                parts.append(types.Part.from_bytes(
                    data=ref.read_bytes(), mime_type="image/png"))
            try:
                r = client.models.generate_content(model=MODEL, contents=parts)
                blob = next(
                    part.inline_data.data
                    for cand in r.candidates
                    for part in cand.content.parts
                    if getattr(part, "inline_data", None)
                )
                out.write_bytes(blob)
                print(f"[ok] {out.name}")
                if kind == "correct":
                    ref = out
            except Exception as e:  # noqa: BLE001
                print(f"[fail] {iid}_{kind}: {e}")
                fail += 1
    if fail:
        print(f"[warn] 실패 {fail}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
