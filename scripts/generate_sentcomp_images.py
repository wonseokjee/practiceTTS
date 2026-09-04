"""문장이해(sentComp) 신규 장면 이미지 생성 스크립트.

Gemini 이미지 모델(google-genai SDK)로 scripts/sentcomp_image_spec.json 의 각 문항에 대해
정답/오답 장면 PNG를 생성하고, frontend/src/assets/data/qabSentGenerated.json 을 갱신한다.
(혼합 퀴즈 QAB 풀에 자동 반영 — 표준 sentComp 검사 JSON은 건드리지 않는다.)

사전 준비:
  - ai-service/.env 의 GEMINI_API_KEY (실제 키) 필요.
  - 이미지 모델명이 환경마다 다를 수 있어 GEMINI_IMAGE_MODEL 로 오버라이드 가능
    (기본: gemini-2.5-flash-image). 모델 not found 오류 시 이 값을 바꿔 재시도.

사용:
  python scripts/generate_sentcomp_images.py --dry-run     # 프롬프트만 출력(API 미호출)
  python scripts/generate_sentcomp_images.py               # 없는 이미지 생성
  python scripts/generate_sentcomp_images.py --force       # 기존 이미지도 재생성
  python scripts/generate_sentcomp_images.py --only sg_01  # 특정 문항만

생성 후 프론트는 Vite가 자동 반영(JSON/이미지). 브라우저 새로고침으로 확인.
"""
import argparse
import io
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / "ai-service" / ".env"
SPEC_PATH = ROOT / "scripts" / "sentcomp_image_spec.json"
IMG_DIR = ROOT / "frontend" / "public" / "assets" / "images" / "sentComp"
OUT_JSON = ROOT / "frontend" / "src" / "assets" / "data" / "qabSentGenerated.json"

DEFAULT_IMAGE_MODEL = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")

# 실어증 환자용: 누가 누구에게 무엇을 하는지 한눈에 명확한, 일관된 단순 삽화 스타일.
STYLE_PREFIX = (
    "Children's picture-book illustration, simple flat colors, thick clean black "
    "outlines, plain solid white background. No text, no letters, no numbers, no "
    "speech bubbles, no labels. Two full-body characters, side view, clear and "
    "unambiguous so a viewer instantly understands who is doing the action to whom. "
    "Friendly and gentle, suitable for elderly stroke-recovery patients.\n\nScene: "
)


def load_env_value(path: Path, key: str) -> str:
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == key:
            return v.strip()
    return ""


def resolve_api_key() -> tuple[str, str]:
    """키를 찾아 (값, 어디서 찾았는지)를 돌려준다.

    **워크트리에서도 돌아가야 한다.** `.env`는 gitignore 대상이라 본 체크아웃에만
    있고 `git worktree`로 만든 트리에는 없다. 이 저장소는 워크트리로 일하는 것이
    기본이라(브랜치마다 따로 둔다), 워크트리의 `.env`만 보면 매번 막힌다.

    찾는 순서:
      1. 환경변수 `GEMINI_API_KEY` — 비밀을 디스크에 복사하지 않는 길
      2. 이 트리의 `ai-service/.env`
      3. **주 저장소**의 `ai-service/.env` — 워크트리면 `.git`이 파일이고
         그 안의 `gitdir:`가 주 저장소를 가리킨다
    """
    env = os.getenv("GEMINI_API_KEY", "").strip()
    if env:
        return env, "환경변수"

    v = load_env_value(ENV_PATH, "GEMINI_API_KEY")
    if v:
        return v, str(ENV_PATH)

    git = ROOT / ".git"
    if git.is_file():
        head = git.read_text(encoding="utf-8").strip()
        if head.startswith("gitdir:"):
            # .../주저장소/.git/worktrees/<이름> → 주저장소
            main_root = Path(head.split(":", 1)[1].strip()).resolve().parents[2]
            alt = main_root / "ai-service" / ".env"
            v = load_env_value(alt, "GEMINI_API_KEY")
            if v:
                return v, str(alt)
    return "", ""


def build_prompt(characters: str, role_prompt: str) -> str:
    chars = f"The two characters are {characters}. " if characters else ""
    return f"{STYLE_PREFIX}{chars}{role_prompt}"


def extract_image_bytes(response) -> bytes | None:
    """google-genai 응답에서 첫 이미지 inline_data 바이트를 추출."""
    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None):
                return inline.data
    return None


def save_png(data: bytes, dest: Path) -> None:
    from PIL import Image  # 정규화를 위해 PIL로 PNG 저장

    img = Image.open(io.BytesIO(data))
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, format="PNG")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="프롬프트만 출력(API 미호출)")
    ap.add_argument("--force", action="store_true", help="기존 이미지도 재생성")
    ap.add_argument("--only", default=None, help="해당 itemId만 처리")
    args = ap.parse_args()

    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    items = spec.get("items", [])
    if args.only:
        items = [it for it in items if it["itemId"] == args.only]
        if not items:
            print(f"[!] --only {args.only}: 스펙에 없음")
            return 1

    client = None
    if not args.dry_run:
        api_key, source = resolve_api_key()
        if not api_key or api_key.lower().startswith("your_"):
            print(
                "[!] GEMINI_API_KEY를 못 찾았습니다. 환경변수로 넘기거나 "
                f"{ENV_PATH} 에 적으세요."
            )
            return 1
        print(f"[i] 키 출처: {source}")
        from google import genai

        client = genai.Client(api_key=api_key)
        print(f"[i] 이미지 모델: {DEFAULT_IMAGE_MODEL}")

    generated_items = []
    fail = 0

    for it in items:
        item_id = it["itemId"]
        characters = it.get("characters", "")
        roles = [
            ("correct", it["correct"], True),
            ("distractor", it["distractor"], False),
        ]
        produced = {}
        for role, spec_choice, is_correct in roles:
            dest = IMG_DIR / f"{item_id}_{role}.png"
            prompt = build_prompt(characters, spec_choice["prompt"])

            if args.dry_run:
                print(f"\n=== {item_id}_{role} ===\n{prompt}")
                produced[role] = dest
                continue

            if dest.exists() and not args.force:
                print(f"[skip] {dest.name} (이미 존재)")
                produced[role] = dest
                continue

            try:
                from google.genai import types

                resp = client.models.generate_content(
                    model=DEFAULT_IMAGE_MODEL,
                    contents=[prompt],
                    config=types.GenerateContentConfig(
                        response_modalities=["TEXT", "IMAGE"]
                    ),
                )
                data = extract_image_bytes(resp)
                if data is None:
                    print(f"[FAIL] {item_id}_{role}: 응답에 이미지가 없음")
                    fail += 1
                    continue
                save_png(data, dest)
                print(f"[ok] {dest.name}")
                produced[role] = dest
            except Exception as exc:  # noqa: BLE001
                print(f"[FAIL] {item_id}_{role}: {exc}")
                print(
                    "      모델명이 틀릴 수 있습니다. GEMINI_IMAGE_MODEL 환경변수로 "
                    "다른 이미지 모델을 지정해 재시도하세요."
                )
                fail += 1

        # 정답/오답 이미지가 모두 있으면(파일 존재) 풀 항목으로 등록
        cor = IMG_DIR / f"{item_id}_correct.png"
        dis = IMG_DIR / f"{item_id}_distractor.png"
        if cor.exists() and dis.exists():
            rel = "/assets/images/sentComp"
            generated_items.append(
                {
                    "itemId": item_id,
                    "sentence": it["sentence"],
                    "sentenceAudioUrl": "",
                    "sentenceType": it.get("sentenceType", "active-passive"),
                    "choices": [
                        {
                            "imageUrl": f"{rel}/{item_id}_correct.png",
                            "altText": it["correct"]["altText"],
                            "isCorrect": True,
                        },
                        {
                            "imageUrl": f"{rel}/{item_id}_distractor.png",
                            "altText": it["distractor"]["altText"],
                            "isCorrect": False,
                        },
                    ],
                }
            )

    if args.dry_run:
        print("\n[dry-run] API 호출 없이 프롬프트만 출력했습니다.")
        return 0

    # 기존 생성분과 병합(이번에 못 만든 항목은 기존 것 유지), itemId 기준 갱신.
    existing = {}
    if OUT_JSON.exists():
        try:
            for x in json.loads(OUT_JSON.read_text(encoding="utf-8")).get("items", []):
                existing[x["itemId"]] = x
        except json.JSONDecodeError:
            pass
    for x in generated_items:
        existing[x["itemId"]] = x

    out = {
        "version": 1,
        "note": "generate_sentcomp_images.py 산출물. 정답/오답 이미지가 모두 생성된 항목만 포함.",
        "items": list(existing.values()),
    }
    OUT_JSON.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\n[done] 등록 항목 {len(out['items'])}개 → {OUT_JSON}")
    if fail:
        print(f"[warn] 실패 {fail}건. 위 메시지를 확인하세요.")
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
