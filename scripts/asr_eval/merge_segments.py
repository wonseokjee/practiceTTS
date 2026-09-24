"""배치별 refine 산출물을 하나의 학습 매니페스트로 합친다.

배경: `refine_segments.py`가 내는 `segments.jsonl`의 `segment_wav_relpath`는
**그 배치의 out_dir 기준 상대경로**다(`<stem>/<stem>_NNN.wav`, 배치 폴더명이
안 붙어 있다). `prepare_colab_trainset.py`는 매니페스트 하나 + `--seg-root`
하나로 전체 wav를 찾으므로, 여러 배치를 한 seg-root 아래 두려면 각 배치
폴더명을 relpath 앞에 붙여야 한다. 이 작업을 6번 손으로 해 왔다(1~5차 배치를
`_segs_merged_all6.jsonl`로). 이 스크립트가 그 규칙을 고정한다.

seg-root 레이아웃(예):
    608-audio-work/
      _segs_big_refined/segments.jsonl   (relpath: "<stem>/<stem>_NNN.wav")
      _segs_big_refined/<stem>/<stem>_NNN.wav
      _segs_merged_all6.jsonl            (relpath: "_segs_big_refined/<stem>/...")

사용:
    python merge_segments.py --seg-root ~/Downloads/608-audio-work \
        --batch _segs_vs01_refined \
        --merged-in _segs_merged_all6.jsonl --merged-out _segs_merged_all7.jsonl

`--merged-in`을 생략하면 `--batch`만으로 새 매니페스트를 만든다(첫 배치용).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def load_batch(seg_root: Path, batch: str) -> list[dict]:
    """배치 폴더의 segments.jsonl을 읽고 relpath에 배치 폴더명을 붙인다."""
    src = seg_root / batch / "segments.jsonl"
    if not src.exists():
        raise SystemExit(f"{src} 가 없다 — --batch 이름이나 --seg-root를 확인해라.")
    rows = [json.loads(l) for l in src.open(encoding="utf-8") if l.strip()]
    for r in rows:
        r["segment_wav_relpath"] = f"{batch}/{r['segment_wav_relpath']}"
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="배치 refine 산출물을 병합 매니페스트에 합친다")
    ap.add_argument("--seg-root", required=True, type=Path)
    ap.add_argument("--batch", required=True, help="seg-root 아래 배치 폴더 이름")
    ap.add_argument("--merged-in", type=Path, default=None, help="기존 병합 매니페스트(없으면 새로 시작)")
    ap.add_argument("--merged-out", required=True, type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    existing: list[dict] = []
    if args.merged_in:
        if not args.merged_in.exists():
            raise SystemExit(f"{args.merged_in} 가 없다.")
        existing = [json.loads(l) for l in args.merged_in.open(encoding="utf-8") if l.strip()]

    new_rows = load_batch(args.seg_root, args.batch)

    # 경로 충돌 확인 — 같은 relpath가 이미 있으면 이전 배치를 또 넣는 것일 수 있다.
    existing_paths = {r["segment_wav_relpath"] for r in existing}
    collide = [r["segment_wav_relpath"] for r in new_rows if r["segment_wav_relpath"] in existing_paths]
    if collide:
        raise SystemExit(
            f"경로가 {len(collide)}개 이미 병합 파일에 있다(예: {collide[0]}). "
            "이 배치를 이미 합친 것 아닌지 확인해라."
        )

    # wav 실재 확인 — 하나라도 없으면 패키징 단계에서 조용히 빠진다(대장 경고).
    missing = [r for r in new_rows if not (args.seg_root / r["segment_wav_relpath"]).exists()]
    if missing:
        print(f"[!] wav가 없는 줄 {len(missing)}개(예: {missing[0]['segment_wav_relpath']})")

    from collections import Counter
    tt = Counter(r.get("task_type") for r in new_rows)
    print(f"기존 {len(existing)}줄 + 배치 '{args.batch}' {len(new_rows)}줄"
          f" {dict(tt)} → 합계 {len(existing) + len(new_rows)}줄")

    if args.dry_run:
        print("모의 실행이다. 실제로 쓰려면 --dry-run 을 빼라.")
        return
    if missing:
        raise SystemExit(f"wav 누락 {len(missing)}건 — 먼저 고쳐라(위 예시 참고).")

    with args.merged_out.open("w", encoding="utf-8") as f:
        for r in existing + new_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"저장: {args.merged_out}")


if __name__ == "__main__":
    main()
