"""align_608 세그먼트 → Colab whisper 파인튜닝용 학습셋 패키지.

align_608이 만든 문장 세그먼트(segments.jsonl + 짧은 wav)를 받아, Colab 노트북이
바로 먹을 수 있는 형태로 변환한다:
  - {"audio": "wav/<화자>/<파일>.wav", "text": "정답 전사"} 형식의 train/test jsonl
  - 화자 분리(한 화자는 train·test 중 한쪽만 — 누수 방지)
  - whisper 30초 제한에 맞춰 너무 길거나 짧은 세그먼트 제외
  - 세그먼트 wav을 out-dir/wav/ 아래로 복사 → 폴더째(또는 --zip) 드라이브 업로드

608은 공개 연구 데이터라 클라우드(드라이브)에 올려도 된다. 단, 산출물에는 전사가
들어가므로 리포에는 커밋하지 않는다(out-dir은 리포 밖 권장).

사용:
  python scripts/asr_eval/prepare_colab_trainset.py \
    --segments ".../608-audio-work/_segs/segments.jsonl" \
    --seg-root ".../608-audio-work/_segs" \
    --out-dir  ".../608-audio-work/colab_trainset" \
    --test-speaker-frac 0.2 --min-sec 1 --max-sec 30 --zip --seed 42
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from split_speakers import speaker_of  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_segments(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def keep(seg: dict, *, min_sec: float, max_sec: float) -> bool:
    """학습에 쓸 세그먼트인지: 전사·wav 있고 길이가 whisper 범위 안."""
    if not (seg.get("reference_text") or "").strip():
        return False
    if not seg.get("segment_wav_relpath"):
        return False
    dur = float(seg.get("end", 0)) - float(seg.get("start", 0))
    return min_sec <= dur <= max_sec


def split_speakers(
    speakers: list[str], *, test_frac: float, dev_frac: float, seed: int
) -> dict[str, str]:
    """화자 → split 매핑(한 화자는 한 split만)."""
    rng = random.Random(seed)
    uniq = sorted(set(speakers))
    rng.shuffle(uniq)
    n = len(uniq)
    n_test = round(n * test_frac)
    n_dev = round(n * dev_frac)
    assign: dict[str, str] = {}
    for i, s in enumerate(uniq):
        assign[s] = "test" if i < n_test else "dev" if i < n_test + n_dev else "train"
    return assign


def main() -> None:
    ap = argparse.ArgumentParser(description="608 세그먼트 → Colab 학습셋")
    ap.add_argument("--segments", required=True, type=Path)
    ap.add_argument("--seg-root", required=True, type=Path, help="segment_wav_relpath 기준 루트")
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--test-speaker-frac", type=float, default=0.2)
    ap.add_argument("--dev-speaker-frac", type=float, default=0.0)
    ap.add_argument("--min-sec", type=float, default=1.0)
    ap.add_argument("--max-sec", type=float, default=30.0)
    ap.add_argument("--zip", action="store_true", help="업로드용 zip도 생성")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    segs = [
        s
        for s in load_segments(args.segments)
        if keep(s, min_sec=args.min_sec, max_sec=args.max_sec)
    ]
    if not segs:
        print("사용할 세그먼트가 없습니다(전사/길이 필터 후 0).")
        sys.exit(2)

    speakers = [speaker_of(s["parent_file_id"]) for s in segs]
    assign = split_speakers(
        speakers,
        test_frac=args.test_speaker_frac,
        dev_frac=args.dev_speaker_frac,
        seed=args.seed,
    )

    out = args.out_dir
    (out / "wav").mkdir(parents=True, exist_ok=True)
    buckets: dict[str, list[dict]] = defaultdict(list)
    copied = 0
    for s in segs:
        spk = speaker_of(s["parent_file_id"])
        split = assign[spk]
        src = args.seg_root / s["segment_wav_relpath"]
        if not src.exists():
            continue
        # out/wav/<화자>/<파일명>
        rel = Path("wav") / spk / Path(s["segment_wav_relpath"]).name
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        copied += 1
        buckets[split].append(
            {"audio": rel.as_posix(), "text": s["reference_text"].strip()}
        )

    for split in ("train", "dev", "test"):
        items = buckets.get(split, [])
        if not items and split == "dev":
            continue
        fp = out / f"{split}.jsonl"
        with fp.open("w", encoding="utf-8") as f:
            for it in items:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
        spk = len({speaker_of_from_audio(it["audio"]) for it in items})
        print(f"  {split}: {len(items)}개 · 화자 {spk} → {fp.name}")

    print(f"wav 복사: {copied} → {out/'wav'}")

    if args.zip:
        base = str(out)
        shutil.make_archive(base, "zip", root_dir=str(out))
        print(f"업로드용 zip: {base}.zip")

    print("\n다음: 이 폴더(또는 zip)를 Google Drive에 올리고, 노트북 BASE를 그 경로로.")


def speaker_of_from_audio(audio_rel: str) -> str:
    """'wav/<화자>/<파일>' 에서 화자 추출(요약 통계용)."""
    parts = Path(audio_rel).parts
    return parts[1] if len(parts) >= 2 else "?"


if __name__ == "__main__":
    main()
