# -*- coding: utf-8 -*-
"""문장이해 장면 **한 쌍**을 다시 그린다.

`generate_sentcomp_images.py`는 새 문항(sg_*)을 만들고 `qabSentGenerated.json`을
갱신한다. 이 스크립트는 **이미 있는 장면의 그림만** 다시 그린다 — JSON은 건드리지
않는다. 문장·정답 구조가 그대로이므로 바꿀 것이 그림뿐이기 때문이다.

## 두 가지를 지켜야 한다

2지선다에서 두 그림은 **역할만** 달라야 한다. 인물·옷·화풍·구도가 함께 바뀌면
환자가 역할이 아니라 그 차이로 답을 고른다. 그래서 짝을 참조 이미지로 넣는다.

그런데 참조를 넣으면 두 번째 문제가 생긴다.

## 있을 법하지 않은 방향을 먼저 그려라

sentComp_02("아이가 엄마에게 밥을 먹이고 있어요")에서 실측한 것이다.
"엄마가 아이를 먹인다" 그림을 참조로 주고 역할을 뒤집으라고 하면, 모델은
아홉 번 중 아홉 번 숟가락을 아이 입으로 되돌렸다 — 참조를 빼고 "아이가 엄마를
먹인다"만 시키면 첫 시도에 나왔다. 모델에게 "어른이 아이를 먹인다"는 강한
선입견이 있고, 참조 이미지가 그것을 더 밀어준다.

그래서 순서가 중요하다:

    1. **드문 방향**을 참조 없이(`none`) 그린다.
    2. 흔한 방향을 1번 결과를 참조로(`pair`) 그린다.

흔한 방향에는 맞서는 선입견이 없어서 참조를 잘 따른다.

## 쓰기

    python scripts/redraw_sentcomp_pair.py \
        --out sentComp_02_distractor --mode none --n 3 \
        --scene "A small boy is feeding his mother. ..."

    python scripts/redraw_sentcomp_pair.py \
        --out sentComp_02_correct --ref <1단계에서 고른 파일> --mode pair --n 3 \
        --scene "The mother is feeding the child. ..."

후보를 여러 장 뽑아 **사람이 고른다.** 한 장만 뽑아 바로 덮으면 되돌리기 어렵고,
역할이 뒤집혔는지는 눈으로 봐야 안다. 결과는 `--dest`(기본: 저장소 밖 임시 폴더)에
쌓이고, 고른 것을 직접 옮겨 넣는다.
"""
import argparse
import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / "ai-service" / ".env"
IMG_DIR = ROOT / "frontend" / "public" / "assets" / "images" / "sentComp"
MODEL = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")

# generate_sentcomp_images.py와 같은 화풍 문구다. 여기서 갈라지면 세트가 섞인다.
STYLE = (
    "Children's picture-book illustration, simple flat colors, thick clean black "
    "outlines, plain solid white background. No text, no letters, no numbers, no "
    "speech bubbles, no labels. Clear and unambiguous so a viewer instantly "
    "understands who is doing the action to whom. Friendly and gentle, suitable "
    "for elderly stroke-recovery patients."
)

PAIR = (
    "The attached image is the OTHER option of the same two-choice question. "
    "Match it exactly: same two characters, same faces, same hair, same clothing "
    "colors, same art style, same line weight, same square framing and figure "
    "scale, same white background. Change ONLY who performs the action."
)

STYLE_ONLY = (
    "The attached image is from the same illustration set. Copy its art style, "
    "line weight and color palette. Do NOT copy its composition or poses — draw "
    "the scene described below."
)


def env_value(key: str) -> str:
    """환경변수를 먼저 보고, 없으면 `ai-service/.env`를 읽는다.

    `.env`는 gitignore라 워크트리에는 없다. 워크트리에서 돌릴 때는
    `GEMINI_API_KEY=... python scripts/...` 처럼 넘기거나, 본 저장소의 .env를
    `--env`로 가리키면 된다.
    """
    from_environ = os.getenv(key, "").strip()
    if from_environ:
        return from_environ
    if not ENV_PATH.exists():
        return ""
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        k, _, v = line.strip().partition("=")
        if k.strip() == key:
            return v.strip()
    return ""


def resolve(name: str) -> Path:
    """저장소의 그림 이름이거나, 앞 단계에서 뽑은 후보 파일 경로."""
    p = Path(name)
    return p if p.exists() else (IMG_DIR / (name + ".png"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="후보 파일 이름 앞부분")
    ap.add_argument("--scene", required=True, help="그릴 장면 설명(영어)")
    ap.add_argument("--ref", default=None, help="참조 그림(이름 또는 경로)")
    ap.add_argument(
        "--mode", default="pair", choices=["pair", "style", "none"],
        help="pair=짝을 그대로 맞춘다 · style=화풍만 · none=참조 없음",
    )
    ap.add_argument("--n", type=int, default=3, help="후보 장수")
    ap.add_argument("--dest", default=None, help="후보를 쌓을 폴더")
    ap.add_argument("--env", default=None, help="ai-service/.env 경로(워크트리용)")
    args = ap.parse_args()

    global ENV_PATH
    if args.env:
        ENV_PATH = Path(args.env)

    if args.mode != "none" and not args.ref:
        print("[!] --mode %s 에는 --ref 가 필요하다" % args.mode)
        return 1

    api_key = env_value("GEMINI_API_KEY")
    if not api_key or api_key.lower().startswith("your_"):
        print("[!] GEMINI_API_KEY가 비어있거나 플레이스홀더다: %s" % ENV_PATH)
        return 1

    from google import genai
    from google.genai import types
    from PIL import Image

    dest = Path(args.dest) if args.dest else Path.cwd() / "sentcomp_candidates"
    dest.mkdir(parents=True, exist_ok=True)

    guide = {"pair": PAIR, "style": STYLE_ONLY, "none": ""}[args.mode]
    prompt = STYLE + (("\n\n" + guide) if guide else "") + "\n\nScene to draw: " + args.scene

    contents = [prompt]
    if args.mode != "none":
        ref = Image.open(resolve(args.ref)).convert("RGB")
        buf = io.BytesIO()
        ref.save(buf, format="PNG")
        contents = [types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"), prompt]
        print("[i] 참조 %s %s" % (resolve(args.ref).name, ref.size))

    client = genai.Client(api_key=api_key)
    print("[i] 모델 %s · 모드 %s" % (MODEL, args.mode))

    made = 0
    for i in range(args.n):
        try:
            resp = client.models.generate_content(model=MODEL, contents=contents)
        except Exception as exc:  # 500·503이 드물지 않다. 한 장 실패로 멈추지 않는다.
            print("[!] %d번 실패: %s" % (i + 1, exc))
            continue
        data = None
        for cand in getattr(resp, "candidates", None) or []:
            for part in getattr(getattr(cand, "content", None), "parts", None) or []:
                inline = getattr(part, "inline_data", None)
                if inline is not None and getattr(inline, "data", None):
                    data = inline.data
                    break
            if data:
                break
        if not data:
            print("[!] %d번: 이미지가 안 왔다" % (i + 1))
            continue
        out = dest / ("%s_cand%d.png" % (args.out, i + 1))
        Image.open(io.BytesIO(data)).save(out, format="PNG")
        print("[ok] %s" % out)
        made += 1

    print("후보 %d장 · %s" % (made, dest))
    return 0 if made else 1


if __name__ == "__main__":
    sys.exit(main())
