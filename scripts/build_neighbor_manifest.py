"""이름대기 이웃 목록(`neighborManifest.ko-KR.json`)을 만든다.

이웃 비교 채점에서 목표 단어와 함께 채점할 "소리가 가까운 다른 앱 단어" 3개다.
설계: docs/history/20260926_NeighborScoring_design.md, 계획: ..._implementation_plan.md PR 1.

**실측에 쓴 함수와 같은 함수다.** 이웃 선정은 `scripts/asr_eval/neighbor_manifest.py`의
`neighbors()`이고, 0단계 실측(오통과 3.5%)이 이 함수로 목록을 만들었다. 여기서 목록을
따로 계산하면 실측한 것과 앱이 쓰는 것이 달라진다.

- 대상: 이름대기에 실제로 나오는 낱말 — 낱말 풀 중 실물 사진이 있는 것(`namingPhotos.json`)
  + 이름대기 전용 낱말(`namingOnlyWords.json`). 프론트 `pickNamingItems`와 같은 집합이다
  (그 일치는 `neighborManifest.test.ts`가 소비자 쪽에서 고정한다).
- 후보: 앱 어휘 전체(낱말 풀·이름대기 전용·따라말하기 낱말).
- 결정적이다(타임스탬프 없음). `--check`는 파일이 현재 데이터와 어긋나면 종료 코드 1.

실행:
    python scripts/build_neighbor_manifest.py          # 쓴다
    python scripts/build_neighbor_manifest.py --check  # 낡았는지만 본다(파일을 안 건드린다)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts" / "asr_eval"))

import neighbor_manifest as N  # noqa: E402

DATA = REPO / "frontend/src/assets/data"
OUT = DATA / "neighborManifest.ko-KR.json"
K = 3
SEED = 42

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _slug(image_url: str) -> str:
    """프론트 `slugFromUrl`과 같은 규칙: 마지막 경로 조각의 확장자를 뗀다."""
    return Path(image_url).stem


def naming_targets(data_dir: Path = DATA) -> list[str]:
    """이름대기에 나올 수 있는 낱말 전부(정렬·중복 제거)."""
    photos = set(json.loads((data_dir / "namingPhotos.json").read_text(encoding="utf-8"))["slugs"])
    pool = json.loads((data_dir / "qabWordPool.json").read_text(encoding="utf-8"))
    words: set[str] = set()
    for item in pool["items"]:
        correct = [c for c in item["choices"] if c["isCorrect"]]
        if len(correct) != 1:
            raise SystemExit(f"{item['itemId']}: 정답 선택지가 {len(correct)}개다")
        if _slug(correct[0]["imageUrl"]) in photos:   # toNamingItem: 사진 있는 것만
            words.add(item["targetWord"].strip())
    only = json.loads((data_dir / "namingOnlyWords.json").read_text(encoding="utf-8"))
    words |= {w["label"].strip() for w in only["items"]}
    return sorted(w for w in words if w)


def build(data_dir: Path = DATA) -> dict:
    vocab = N.load_app_vocab(data_dir)
    manifest = N.build_manifest(naming_targets(data_dir), vocab, k=K, seed=SEED)
    manifest["scope"] = "naming"
    return manifest


def render(manifest: dict) -> str:
    return json.dumps(manifest, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="이름대기 이웃 목록을 만든다")
    ap.add_argument("--check", action="store_true", help="파일이 낡았는지만 본다")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    want = render(build())
    if args.check:
        have = args.out.read_text(encoding="utf-8") if args.out.exists() else ""
        if have != want:
            print(f"낡았다 또는 없다: {args.out}\n  python scripts/build_neighbor_manifest.py 로 다시 만들어라.",
                  file=sys.stderr)
            return 1
        print("최신이다:", args.out)
        return 0

    args.out.write_text(want, encoding="utf-8", newline="\n")
    m = json.loads(want)
    print(f"{args.out} · 낱말 {len(m['neighbors'])}개 · k={m['k']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
