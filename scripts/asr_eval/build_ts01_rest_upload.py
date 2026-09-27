"""미사용 TS01 문장 파일 → Colab 정렬용 업로드 패키지 (TODOS 3b).

로컬 TS01.zip에서 아직 정렬하지 않은 문장 파일(train·신규 화자 209개)을 꺼내
16kHz 모노 FLAC로 줄이고, 정렬 노트북(`align_ts01rest_colab.ipynb`)이 먹는 모양으로 묶는다.

**우선순위.** 228시간이라 T4로도 여러 세션이 걸린다. 그래서 파일을 **앱 표적 단어가 녹음
1시간당 많이 나오는 순서**로 매니페스트에 적고, 같은 순서로 zip 조각(part)을 나눈다.
`align_608`은 매니페스트 순서대로 돌고 `_attempted.txt`로 재개하므로, 세션이 끊겨도 가장
쓸모 있는 파일부터 끝나 있다.

**화자 누수.** 대장 4절은 이 화자들을 "전원 신규"로 적었지만 **틀렸다** — 65명 중 51명이
이미 봉인된 스플릿(`speaker_split.json`)에 있다(train 36 · dev 5 · test 10, 2026-09-27 확인).
dev·test 화자의 새 녹음을 학습에 넣으면 누수고, 평가에 넣으면 시험지가 바뀐다. 그래서
**train 화자와 신규 화자의 파일만** 올린다. dev·test 화자의 파일(69개)은 빼 두고
`excluded_eval_speakers.jsonl`에 적는다 — 나중에 앱 어휘 평가셋의 재료가 될 수 있다.

**FLAC.** 원본은 48kHz라 278파일이 77.8GB다. 16kHz 모노 FLAC이면 녹음 1시간에 약 21MB라
209파일이 약 3.8GB다(침묵이 잘 압축된다). 정렬은 어차피 16kHz로 한다. `refine_segments.py`는 `wave`로 읽으므로 Colab에서
WAV로 되돌린다(노트북 셀 3). 매니페스트의 `expected_audio_relpath`는 그 WAV 경로다.

실행:
    python scripts/asr_eval/build_ts01_rest_upload.py --estimate   # 목록·우선순위만
    python scripts/asr_eval/build_ts01_rest_upload.py              # 변환 + zip 조각
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import build_target_foils as F  # noqa: E402
from baseline_asr import task_type  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

W = Path(os.path.expanduser("~/Downloads/608-audio-work"))
LABELS = Path(os.path.expanduser("~/Downloads/608-labels/manifest608_all.jsonl"))
OUT = W / "ts01rest_upload"
AUDIO_DIR = "ts01rest"          # 업로드 안·Colab audio-root 아래 폴더
PART_BYTES = 1_000_000_000      # zip 조각 크기(대략). 드라이브 FUSE가 한 번에 큰 파일을 읽다 끊긴 적이 있다

PART = ("을", "를", "이", "가", "은", "는", "과", "와", "도", "에", "에서", "의", "로", "으로",
        "만", "하고", "이랑", "랑", "처럼")


def app_word_hits(transcript: str, words: list[str]) -> int:
    """전사 속 앱 단어 어절 수(단어 또는 단어+조사). cut_word_segments.find_targets와 같은 규칙."""
    n = 0
    for tok in re.sub(r"[^\w\s]", " ", transcript).split():
        if any(tok == w or (tok.startswith(w) and tok[len(w):] in PART) for w in words):
            n += 1
    return n


def speaker(file_id: str) -> str:
    return file_id.split("-")[4]


def select(zip_names: set[str]) -> list[dict]:
    rows = [json.loads(l) for l in LABELS.open(encoding="utf-8") if l.strip()]
    used = set()
    for f in glob.glob(str(W / "align_manifest*.jsonl")):
        for l in open(f, encoding="utf-8"):
            used.add(json.loads(l)["file_id"])
    words = sorted(F.load_pool(F.DEFAULT_POOL))
    out = []
    for r in rows:
        if "TL01" not in r["label_relpath"] or r["file_id"] in used:
            continue
        if task_type(r["transcript"]) != "narrative" or r["file_id"] not in zip_names:
            continue
        hits = app_word_hits(r["transcript"], words)
        out.append({**r, "app_word_hits": hits,
                    "hits_per_hour": hits / (r["play_time_sec"] / 3600),
                    "expected_audio_relpath": f"{AUDIO_DIR}/{Path(r['file_id']).stem}.wav"})
    # 앱 단어 밀도 내림차순, 동점은 file_id로 — 재실행해도 같은 순서
    out.sort(key=lambda r: (-r["hits_per_hour"], r["file_id"]))
    return out


def split_by_speaker(sel: list[dict]) -> tuple[list[dict], list[dict]]:
    """(올릴 것, 뺄 것). 봉인 스플릿에서 dev·test인 화자의 파일은 뺀다."""
    split = json.load(open(W / "speaker_split.json", encoding="utf-8"))   # {화자: train|dev|test}
    keep = [r for r in sel if split.get(speaker(r["file_id"]), "new") in ("train", "new")]
    drop = [dict(r, split=split[speaker(r["file_id"])]) for r in sel
            if split.get(speaker(r["file_id"]), "new") not in ("train", "new")]
    return keep, drop


SCRIPTS = ["align_608.py", "asr_eval/refine_segments.py", "asr_eval/baseline_asr.py",
           "asr_eval/metrics.py", "asr_eval/split_speakers.py"]


def write_scripts_zip() -> Path:
    """정렬 노트북이 쓰는 스크립트 묶음 + 커밋 기록(VERSION.txt)."""
    root = HERE.parent
    rev = subprocess.run(["git", "-C", str(root), "log", "-1", "--format=%h %s"],
                         capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", str(root), "status", "--porcelain", "--"] + SCRIPTS,
                           capture_output=True, text=True).stdout.strip()
    out = OUT / "ts01rest_scripts.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in SCRIPTS:
            zf.write(root / rel, rel)
        zf.writestr("VERSION.txt", f"{rev}{' (작업 트리 변경 있음)' if dirty else ''}\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="미사용 TS01 문장 → Colab 정렬 업로드")
    ap.add_argument("--estimate", action="store_true")
    ap.add_argument("--scripts-only", action="store_true", help="스크립트 zip만 다시 만든다")
    args = ap.parse_args()
    if args.scripts_only:
        OUT.mkdir(parents=True, exist_ok=True)
        print("스크립트:", write_scripts_zip())
        return 0

    z = zipfile.ZipFile(W / "TS01.zip")
    members = {os.path.basename(i.filename): i for i in z.infolist() if i.filename.endswith(".wav")}
    sel, drop = split_by_speaker(select(set(members)))
    print(f"dev·test 화자라 뺀 파일 {len(drop)}개 · {sum(r['play_time_sec'] for r in drop) / 3600:.0f}시간"
          f" · 앱 단어 {sum(r['app_word_hits'] for r in drop)}")
    hours = sum(r["play_time_sec"] for r in sel) / 3600
    hits = sum(r["app_word_hits"] for r in sel)
    print(f"파일 {len(sel)} · {hours:.0f}시간 · 화자 {len({speaker(r['file_id']) for r in sel})} · 앱 단어 어절 {hits}")
    acc_h = acc_n = 0.0
    for q in (0.25, 0.5, 0.75, 1.0):
        k = max(1, round(q * len(sel)))
        h = sum(r["play_time_sec"] for r in sel[:k]) / 3600
        n = sum(r["app_word_hits"] for r in sel[:k])
        print(f"  앞 {k}파일: {h:.0f}시간({h / hours:.0%}) · 앱 단어 {n}({n / hits:.0%})")
    if args.estimate:
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / "_tmp"
    tmp.mkdir(exist_ok=True)
    manifest = [{k: v for k, v in r.items() if k not in ("hits_per_hour",)} for r in sel]
    (OUT / "excluded_eval_speakers.jsonl").write_text(
        "".join(json.dumps({k: r[k] for k in ("file_id", "split", "play_time_sec", "app_word_hits")},
                           ensure_ascii=False) + "\n" for r in drop), encoding="utf-8")
    (OUT / "align_manifest_ts01rest.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in manifest), encoding="utf-8")

    part, size, zf, parts = 0, 0, None, []
    for i, r in enumerate(sel, 1):
        stem = Path(r["file_id"]).stem
        flac = tmp / f"{stem}.flac"
        if not flac.exists():
            src = tmp / r["file_id"]
            with z.open(members[r["file_id"]]) as f, open(src, "wb") as o:
                while chunk := f.read(1 << 24):
                    o.write(chunk)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "16000",
                            "-sample_fmt", "s16", str(flac)], check=True)
            src.unlink()
        if zf is None or size >= PART_BYTES:
            if zf:
                zf.close()
            part += 1
            name = f"ts01rest_part{part:02d}.zip"
            parts.append(name)
            zf = zipfile.ZipFile(OUT / name, "w", zipfile.ZIP_STORED)   # FLAC은 이미 압축돼 있다
            size = 0
        zf.write(flac, f"{AUDIO_DIR}/{stem}.flac")
        size += flac.stat().st_size
        if i % 20 == 0:
            print(f"  {i}/{len(sel)} · part {part}", flush=True)
    zf.close()
    print("조각:", ", ".join(f"{p} ({(OUT / p).stat().st_size / 1e9:.2f}GB)" for p in parts))
    print("매니페스트:", OUT / "align_manifest_ts01rest.jsonl")
    print("스크립트:", write_scripts_zip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
