"""608 2차 배치: 이미 정렬한 파일을 제외하고 새 N개를 과제유형 균형·화자
다양성으로 골라 wav 추출 + align_608용 매니페스트를 만든다.

1차(align_manifest_big.jsonl, 48파일)로 0.80→0.424를 얻었고, 데이터를 더 넣어
CER을 더 낮추려 한다. 기존 파일을 다시 정렬하면 시간 낭비 + 테스트 누수 위험이
있으므로, 이미 쓴 file_id를 제외한 새 파일만 뽑는다.

사용:
  python scripts/select_608_batch2.py \
    --zip "C:/Users/wsji9/Downloads/608-audio-work/TS01.zip" \
    --manifest "C:/Users/wsji9/Downloads/608-labels/manifest608_all.jsonl" \
    --exclude "C:/Users/wsji9/Downloads/608-audio-work/align_manifest_big.jsonl" \
    --out-dir "C:/Users/wsji9/Downloads/608-audio-work" \
    --count 150 --max-sec 300 --out-manifest align_manifest_big2.jsonl
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
import collections
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "asr_eval"))
from baseline_asr import task_type  # noqa: E402
from split_speakers import speaker_of  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _zip_wav_ids(zpath: Path) -> set[str]:
    zf = zipfile.ZipFile(zpath)
    ids = {
        info.filename.split("/")[-1]
        for info in zf.infolist()
        if info.filename.lower().endswith(".wav")
    }
    zf.close()
    return ids


def _load_fids(path: Path) -> set[str]:
    """jsonl에서 file_id 집합을 뽑는다(제외 목록용)."""
    out: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.add(json.loads(line)["file_id"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="608 2차 배치 선택 + 추출")
    ap.add_argument("--zip", required=True, type=Path)
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--exclude", required=True, type=Path, help="이미 정렬한 매니페스트")
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--count", type=int, default=150, help="새로 뽑을 총 파일 수")
    ap.add_argument("--max-sec", type=float, default=300)
    ap.add_argument("--out-manifest", default="align_manifest_big2.jsonl")
    args = ap.parse_args()

    man = {}
    for l in args.manifest.read_text(encoding="utf-8").splitlines():
        if l.strip():
            row = json.loads(l)  # 줄당 1회만 파싱(키·값에 두 번 파싱하지 않게)
            man[row["file_id"]] = row
    zip_ids = _zip_wav_ids(args.zip)
    done = _load_fids(args.exclude)
    print(f"전체 매니페스트 {len(man)} · zip wav {len(zip_ids)} · 기존 정렬 {len(done)}")

    # 후보: zip에 있고, 상한 이하이고, 아직 안 쓴 파일. 남은 608은 대부분 긴
    # 낭독(narrative)이라 과제유형 균형은 무의미 → 짧은 순 + 화자 다양성 우선의
    # 전역 선택으로 컴퓨트를 아끼면서 새 화자를 최대한 담는다.
    cand: list[dict] = []
    for fid in zip_ids:
        if fid in done:
            continue
        r = man.get(fid)
        if not r:
            continue
        if float(r.get("play_time_sec") or 0) > args.max_sec:
            continue
        cand.append(r)

    cand.sort(key=lambda r: float(r.get("play_time_sec") or 0))  # 짧은 것부터
    seen: set[str] = set()
    chosen: list[dict] = []
    for r in cand:  # 1차: 화자 중복 없이(일반화 위해 화자 다양성 우선)
        s = speaker_of(r["file_id"])
        if s in seen:
            continue
        seen.add(s)
        chosen.append(r)
        if len(chosen) >= args.count:
            break
    if len(chosen) < args.count:  # 2차: 부족하면 화자 중복 허용해 짧은 순으로 채움
        for r in cand:
            if len(chosen) >= args.count:
                break
            if r not in chosen:
                chosen.append(r)
    tt = collections.Counter(task_type(r["transcript"]) for r in chosen)
    print(f"  과제유형: {dict(tt)}")

    total_sec = sum(float(r.get("play_time_sec") or 0) for r in chosen)
    all_spk = len({speaker_of(r["file_id"]) for r in chosen})
    print(f"2차 배치: {len(chosen)}파일 · {total_sec/60:.1f}분 · 화자 {all_spk}")

    # wav 추출(align_608은 audio-root/expected_audio_relpath 존재를 확인한다)
    wav_dir = args.out_dir / "wav"
    wav_dir.mkdir(parents=True, exist_ok=True)
    zf = zipfile.ZipFile(args.zip)
    zinfo = {i.filename.split("/")[-1]: i for i in zf.infolist()
             if i.filename.lower().endswith(".wav")}
    extracted = 0
    for r in chosen:
        fid = r["file_id"]
        out = wav_dir / fid
        if out.exists():
            continue
        with zf.open(zinfo[fid]) as src, open(out, "wb") as dst:
            while True:
                b = src.read(1 << 20)
                if not b:
                    break
                dst.write(b)
        extracted += 1
    zf.close()
    print(f"wav 신규 추출: {extracted}/{len(chosen)} → {wav_dir}")

    # align_608 매니페스트(expected_audio_relpath = 평면 파일명)
    out_manifest = args.out_dir / args.out_manifest
    with out_manifest.open("w", encoding="utf-8") as f:
        for r in chosen:
            r = dict(r)
            r["expected_audio_relpath"] = r["file_id"]
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"매니페스트: {out_manifest}")
    print("\n다음(백그라운드):")
    print(
        f'  python scripts/align_608.py --manifest "{out_manifest}" '
        f'--audio-root "{wav_dir}" --out-dir "{args.out_dir / "_segs_big2"}" --model small'
    )


if __name__ == "__main__":
    main()
