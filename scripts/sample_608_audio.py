"""608 TS01.zip에서 과제유형 균형 오디오 표본을 뽑아 baseline_asr 스플릿을 만든다.

첫 실측(n=5)에서 CER이 '중증도 × 과제유형(단어나열 vs 서술문)'으로 크게 갈렸다.
안정된 숫자를 내려면 두 유형을 균형 있게 담은 표본이 필요하다. 긴 낭독은 CPU
whisper로 감당이 안 되므로 --max-sec로 상한을 둔다.

동작:
  1. 매니페스트 중 zip에 실제 존재하는 발화만 추린다(file_id 매칭).
  2. 과제유형(narrative/wordlist)로 분류(baseline_asr.task_type 재사용).
  3. 유형별로 --max-sec 이하에서 짧은 것부터 --per-task개 뽑는다(화자 중복 최소화).
  4. 해당 wav을 zip에서 추출(zipfile, ASCII file_id 매칭 — 한글경로 무관).
  5. sample_split.jsonl 저장 + 실행할 baseline 명령을 안내한다.

whisper는 여기서 돌리지 않는다(무거움). 산출 스플릿으로 baseline_asr를 따로 돌린다.

사용:
  python scripts/sample_608_audio.py \
    --zip "C:/Users/wsji9/Downloads/608-audio-work/TS01.zip" \
    --manifest "C:/Users/wsji9/Downloads/608-labels/manifest608_all.jsonl" \
    --out-dir "C:/Users/wsji9/Downloads/608-audio-work" \
    --per-task 10 --max-sec 300 --seed 42
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "asr_eval"))
from baseline_asr import task_type  # noqa: E402
from split_speakers import speaker_of  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _zip_fids(zpath: Path) -> dict[str, zipfile.ZipInfo]:
    """zip 안 wav들을 {file_id: ZipInfo}로. ASCII file_id는 인코딩과 무관하게 보존."""
    zf = zipfile.ZipFile(zpath)
    out: dict[str, zipfile.ZipInfo] = {}
    for info in zf.infolist():
        base = info.filename.split("/")[-1]
        if base.lower().endswith(".wav"):
            out[base] = info
    zf.close()
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="608 과제유형 균형 오디오 표본 추출")
    ap.add_argument("--zip", required=True, type=Path)
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--per-task", type=int, default=10, help="유형별 표본 수")
    ap.add_argument("--max-sec", type=float, default=300, help="이보다 긴 파일 제외(컴퓨트 상한)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    man = {
        json.loads(l)["file_id"]: json.loads(l)
        for l in args.manifest.read_text(encoding="utf-8").splitlines()
        if l.strip()
    }
    zfids = _zip_fids(args.zip)

    # zip에 있고 상한 이하인 발화만, 유형별로 모은다
    by_task: dict[str, list[dict]] = defaultdict(list)
    for fid, info in zfids.items():
        r = man.get(fid)
        if not r:
            continue
        if float(r.get("play_time_sec") or 0) > args.max_sec:
            continue
        by_task[task_type(r["transcript"])].append(r)

    # 유형별로 화자 다양성을 위해 화자당 1개 우선, 짧은 것부터
    chosen: list[dict] = []
    for task, rows in by_task.items():
        rows.sort(key=lambda r: float(r.get("play_time_sec") or 0))
        seen_spk: set[str] = set()
        picked: list[dict] = []
        for r in rows:  # 1차: 화자 중복 없이
            s = speaker_of(r["file_id"])
            if s in seen_spk:
                continue
            seen_spk.add(s)
            picked.append(r)
            if len(picked) >= args.per_task:
                break
        for r in rows:  # 2차: 부족하면 채우기
            if len(picked) >= args.per_task:
                break
            if r not in picked:
                picked.append(r)
        chosen += picked
        secs = sum(float(r.get("play_time_sec") or 0) for r in picked)
        print(f"  {task:10} {len(picked)}개 · {secs/60:.1f}분 · 화자 {len({speaker_of(r['file_id']) for r in picked})}")

    total_sec = sum(float(r.get("play_time_sec") or 0) for r in chosen)
    print(f"표본 합계: {len(chosen)}발화 · {total_sec/60:.1f}분 오디오")

    # wav 추출
    wav_dir = args.out_dir / "wav"
    wav_dir.mkdir(parents=True, exist_ok=True)
    zf = zipfile.ZipFile(args.zip)
    extracted = 0
    for r in chosen:
        fid = r["file_id"]
        info = zfids.get(fid)
        out = wav_dir / fid
        if out.exists():
            extracted += 1
            continue
        with zf.open(info) as src, open(out, "wb") as dst:
            while True:
                b = src.read(1 << 20)
                if not b:
                    break
                dst.write(b)
        extracted += 1
    zf.close()
    print(f"wav 추출: {extracted}/{len(chosen)} → {wav_dir}")

    split = args.out_dir / "sample_split.jsonl"
    with split.open("w", encoding="utf-8") as f:
        for r in chosen:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"스플릿: {split}")
    print("\n다음 실행(백그라운드 권장):")
    print(
        f'  python scripts/asr_eval/baseline_asr.py --split "{split}" '
        f'--audio-root "{wav_dir}" --model small'
    )


if __name__ == "__main__":
    main()
