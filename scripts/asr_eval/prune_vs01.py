"""VS01 압축 해제본에서 단어 파일만 남기고 나머지를 치운다.

배경: VS01_뇌신경장애는 74.76GB인데 우리가 쓰는 건 **단어 264파일(41.3h, 전체의
9%)** 뿐이다. 9차가 "같은 클립 반복은 값을 못 한다"를 실측으로 닫았고, 남은 길은
단어 화자 수를 26 → 112명으로 늘리는 것이다. 문장은 로컬에 이미 228.3h가 미사용
상태로 남아 있어(4절) 더 받을 이유가 없다.

**문장 화자와 단어 화자가 83/86 겹치지만 문장을 버려도 된다.** 스플릿이 화자
단위라 한 화자는 통째로 한 split에만 들어간다 — 그 화자의 문장을 안 갖는 것은
누출이 아니라 데이터 선택일 뿐이고, dev/test가 단어만 커지는 건 오히려 목적에 맞다
(문장 지표는 재현오차 0.0005로 이미 충분하다).

안전 장치 — 이 저장소는 "나중에 필요했던 걸 지운" 전력이 있다(`_segs_*` 건):
  · 기본이 **모의 실행**이다. `--apply` 없이는 아무것도 안 지운다.
  · 매니페스트에 없는 파일은 **절대 안 건드리고** 목록으로 보고만 한다.
  · `--move-to`를 주면 지우는 대신 옮긴다(되돌릴 수 있다).
  · 라벨(VL01, 3.64MB)은 로컬에 남아 있으므로 무엇을 지웠는지 언제든 재구성해
    필요하면 그 파일만 다시 받을 수 있다.

사용:
    python prune_vs01.py --root <압축푼 폴더> --manifest ~/Downloads/608-labels/manifest608_all.jsonl
    python prune_vs01.py --root ... --manifest ... --apply
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

# 윈도우 콘솔 기본이 cp949라 표현 못 하는 글자에서 UnicodeEncodeError로 죽는다.
# 68GB를 지우는 도구가 출력 한 줄 때문에 중간에 터지면 안 된다.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def task_type(transcript: str) -> str:
    """`baseline_asr.task_type`과 같은 규칙. 두 곳이 갈라지면 분류가 어긋난다."""
    return "narrative" if sum(transcript.count(c) for c in ".?!") >= 3 else "wordlist"


def _fmt(nbytes: int) -> str:
    g = nbytes / 2**30
    return f"{g:.2f} GB" if g >= 1 else f"{nbytes / 2**20:.0f} MB"


def main() -> None:
    ap = argparse.ArgumentParser(description="VS01에서 단어만 남긴다")
    ap.add_argument("--root", required=True, type=Path, help="압축 푼 폴더(어디든 — 아래를 훑는다)")
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--split", default="val", help="기본 val(=VS01)")
    ap.add_argument("--apply", action="store_true", help="실제로 지운다(기본은 모의 실행)")
    ap.add_argument("--move-to", type=Path, help="지우는 대신 이 폴더로 옮긴다")
    args = ap.parse_args()

    rows = [json.loads(l) for l in args.manifest.open(encoding="utf-8")]
    # file_id로 판정한다. 같은 이름이 두 split에 없다는 건 매니페스트가 보장한다.
    kind = {
        r["file_id"]: task_type(r.get("transcript") or "")
        for r in rows
        if r.get("split") == args.split
    }
    if not kind:
        raise SystemExit(f"매니페스트에 split={args.split} 행이 없다.")

    keep: list[Path] = []
    drop: list[Path] = []
    unknown: list[Path] = []
    for p in sorted(args.root.rglob("*.wav")):
        k = kind.get(p.name)
        if k is None:
            unknown.append(p)      # 매니페스트에 없다 → 손대지 않는다
        elif k == "wordlist":
            keep.append(p)
        else:
            drop.append(p)

    sz = lambda ps: sum(p.stat().st_size for p in ps)
    print(f"뿌리: {args.root}")
    print(f"  남길 단어 {len(keep):5}개  {_fmt(sz(keep))}   (매니페스트 기준 264개)")
    print(f"  치울 문장 {len(drop):5}개  {_fmt(sz(drop))}")
    if unknown:
        print(f"  [!] 매니페스트에 없는 wav {len(unknown)}개 — **건드리지 않는다**")
        for p in unknown[:5]:
            print(f"       {p.name}")
        if len(unknown) > 5:
            print(f"       … 외 {len(unknown) - 5}개")
    if len(keep) != 264:
        print(f"  [!] 단어가 264개가 아니다({len(keep)}개). 해제가 덜 됐거나 뿌리가 틀렸다.")

    if not args.apply:
        print("\n모의 실행이다. 실제로 치우려면 --apply (되돌리려면 --move-to도 같이).")
        return
    if not drop:
        print("\n치울 것이 없다.")
        return

    if args.move_to:
        args.move_to.mkdir(parents=True, exist_ok=True)
        for p in drop:
            shutil.move(str(p), str(args.move_to / p.name))
        print(f"\n{len(drop)}개를 {args.move_to}로 옮겼다.")
    else:
        for p in drop:
            p.unlink()
        print(f"\n{len(drop)}개를 지웠다. ({_fmt(sz(keep))}만 남았다)")
    print("라벨(VL01)이 남아 있으므로 무엇을 치웠는지는 언제든 재구성할 수 있다.")


if __name__ == "__main__":
    main()
