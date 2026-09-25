"""단어 몇 종을 train·dev·test 전체에서 빼고, 그 단어의 모든 클립을 홀드아웃
평가셋으로 모은다.

배경: 11차 통제군 평가에서 단어 CER 이득의 26~27%만 "통제군 학습 어휘 밖"에서
났고 나머지는 통제군도 본 단어에서 났다(대장 `608-finetune-log.md`, 어휘 분해
절). 그 어휘 밖 프록시는 118개(30종)뿐이고 통제군 쪽 사정(어떤 단어가 언제
빠졌는지)에 좌우돼 신뢰할 잣대가 아니었다. 이 스크립트는 **11차 레시피 자체가**
한 번도 안 본 단어에서 어떻게 하는지를 직접 재려고, 특정 단어를 학습에서
통째로 뺀다.

각 행에 원래 스플릿(`orig_split`)을 남긴다 — 원래 train이었던 행은 **이번
실험에서만** 처음 보지만 새 test(원래 test였던 행)는 **어느 모델에게도**
처음이라, 둘을 구분해야 홀드아웃 모델과 통제군(7차재현·10차·11차)을 공정하게
비교할 수 있다. 11차는 원래 train 행을 이미 학습했으므로 그 부분에서는
비교가 안 된다.

사용:
    python build_vocab_holdout.py --src colab_trainset_big7 \\
        --out colab_trainset_big7_vochold --words 가위 거울 꽃 ... --zip
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):   # 윈도우 cp949 콘솔에서 화살표·마이너스 기호가 죽는 것 방지
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def load(src: Path, split: str) -> list[dict]:
    p = src / f"{split}.jsonl"
    return [json.loads(l) for l in p.open(encoding="utf-8") if l.strip()]


def main() -> None:
    ap = argparse.ArgumentParser(description="단어를 학습에서 통째로 빼고 홀드아웃 평가셋을 만든다")
    ap.add_argument("--src", required=True, type=Path, help="기존 패키지(prepare_colab_trainset.py 산출) 폴더")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--words", required=True, nargs="+", help="완전히 빼낼 단어(정확 일치)")
    ap.add_argument("--zip", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    holdout = set(args.words)
    splits = {s: load(args.src, s) for s in ("train", "dev", "test")}

    def is_holdout(r: dict) -> bool:
        return r["task_type"] == "wordlist" and r["text"].strip() in holdout

    new_splits: dict[str, list[dict]] = {}
    holdout_eval: list[dict] = []
    for s, rows in splits.items():
        keep, drop = [], []
        for r in rows:
            (drop if is_holdout(r) else keep).append(r)
        new_splits[s] = keep
        for r in drop:
            holdout_eval.append({**r, "orig_split": s})

    found = {r["text"].strip() for r in holdout_eval}
    missing = holdout - found
    if missing:
        print(f"[!] 이 단어들은 src에 아예 없었다(오타 확인): {sorted(missing)}")

    from collections import Counter

    print(f"src: {args.src}  →  홀드아웃 단어 {len(holdout)}종")
    for s in ("train", "dev", "test"):
        before, after = len(splits[s]), len(new_splits[s])
        print(f"  {s:5}: {before:5} → {after:5}  (−{before - after})")
    by_orig = Counter(r["orig_split"] for r in holdout_eval)
    print(f"  홀드아웃 평가셋: {len(holdout_eval)}개  (원래 스플릿: {dict(by_orig)})")
    print("  ⚠️ 원래 train이었던 행은 11차 등 big7 전체로 학습한 모델에게는 이미 본 데이터다.")
    print("     공정 비교(어느 모델도 못 본 데이터)는 orig_split이 dev 또는 test인 행만 써라.")

    if args.dry_run:
        print("\n모의 실행이다. 실제로 쓰려면 --dry-run 을 빼라.")
        return

    args.out.mkdir(parents=True, exist_ok=True)
    for s, rows in new_splits.items():
        with (args.out / f"{s}.jsonl").open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with (args.out / "holdout_eval.jsonl").open("w", encoding="utf-8") as f:
        for r in holdout_eval:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (args.out / "holdout_words.json").write_text(
        json.dumps(sorted(holdout), ensure_ascii=False, indent=1), encoding="utf-8"
    )

    # wav는 새로 자르지 않는다 — 기존 패키지의 wav 전체를 그대로 재사용한다.
    # (참조되는 wav가 더 적어졌을 뿐 경로 체계는 같다. 전부 옮기면 새 zip이
    # 필요 없는 wav까지 실어 커지지만, 어떤 행이 어느 wav를 가리키는지 따로
    # 추적하지 않아도 돼 안전하다 — 특히 holdout_eval이 세 스플릿에서 섞여
    # 왔으므로 부분 복사는 실수하기 쉽다.)
    src_wav, out_wav = args.src / "wav", args.out / "wav"
    if out_wav.exists():
        shutil.rmtree(out_wav)
    shutil.copytree(src_wav, out_wav)
    print(f"\nwav 재사용 복사: {src_wav} → {out_wav}")

    if args.zip:
        zpath = args.out.with_suffix(".zip")
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for p in args.out.rglob("*"):
                if p.is_file():
                    z.write(p, p.relative_to(args.out.parent))
        print(f"zip: {zpath}  ({zpath.stat().st_size / 2**20:.0f} MB)")


if __name__ == "__main__":
    main()
