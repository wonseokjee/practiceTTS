"""AI Hub dataSetSn=608 '구음장애 음성인식 데이터' 라벨(JSON) → 매니페스트 변환기.

라벨 JSON 트리를 순회하여 채점·학습에 필요한 필드만 뽑아
JSONL/CSV 매니페스트로 만든다. 오디오(TS01/VS01)를 나중에 받으면
`expected_audio_relpath` 로 바로 페어링할 수 있다.

산출물에는 환자 발화 전사(민감정보)가 포함되므로 기본 출력 경로를
리포 밖으로 두고, 절대 깃에 커밋하지 않는다.

사용 예:
  # 전체
  python scripts/build_608_manifest.py --root "C:/Users/wsji9/Downloads/608-labels"
  # 중풍(뇌졸중)+뇌부상만
  python scripts/build_608_manifest.py --root "..." --categories 11,12
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter
from pathlib import Path

# 폴더 접두 코드 → 사람이 읽는 질환 라벨
CATEGORY_NAMES = {
    "11": "중풍(뇌졸중)",
    "12": "뇌부상",
    "13": "뇌성마비",
    "15": "기타/복합",
    "25": "언어+뇌신경",
    "26": "청각+뇌신경",
}


def _category_code(json_path: Path) -> str:
    """경로 안의 '11.중풍' 같은 세그먼트에서 숫자 코드를 뽑는다."""
    for part in json_path.parts:
        head = part.split(".", 1)[0]
        if head.isdigit() and head in CATEGORY_NAMES:
            return head
    # 폴더명이 예상과 다르면 첫 두 자리 숫자 폴더라도 잡아본다
    for part in json_path.parts:
        head = part.split(".", 1)[0]
        if len(head) == 2 and head.isdigit():
            return head
    return "??"


def _split_of(json_path: Path) -> str:
    s = str(json_path).replace(os.sep, "/")
    if "1.Training" in s:
        return "train"
    if "2.Validation" in s:
        return "val"
    return "?"


def _expected_audio_relpath(json_path: Path, root: Path, file_id: str) -> str:
    """라벨 경로를 원천데이터(오디오) 경로로 변환한 상대경로를 예측한다.

    .../라벨링데이터/TL01_.../<cat>/<name>.json
      → .../원천데이터/TS01_.../<cat>/<File_id>
    (Validation은 VL01→VS01)
    """
    rel = json_path.relative_to(root)
    parts = list(rel.parts)
    conv = []
    for p in parts:
        p2 = p.replace("라벨링데이터", "원천데이터")
        if p2.startswith("TL"):
            p2 = "TS" + p2[2:]
        elif p2.startswith("VL"):
            p2 = "VS" + p2[2:]
        conv.append(p2)
    # 마지막(파일명)은 File_id(.wav)로 교체
    if file_id:
        conv[-1] = file_id
    return "/".join(conv)


def main() -> int:
    # Windows 콘솔 기본 cp949에서 한글/이모지 출력이 깨지지 않도록 UTF-8 강제
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass

    ap = argparse.ArgumentParser(description="608 라벨 → 매니페스트")
    ap.add_argument("--root", required=True, help="라벨 압축해제 루트 (013.구음장애... 상위)")
    ap.add_argument("--categories", default="", help="쉼표구분 코드 필터 (예: 11,12). 미지정=전체")
    ap.add_argument("--out-dir", default="", help="산출물 폴더 (기본: --root)")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        print(f"[오류] root 경로 없음: {root}", file=sys.stderr)
        return 1
    out_dir = Path(args.out_dir).resolve() if args.out_dir else root
    out_dir.mkdir(parents=True, exist_ok=True)

    wanted = {c.strip() for c in args.categories.split(",") if c.strip()}

    rows = []
    cat_counter: Counter = Counter()
    split_counter: Counter = Counter()
    skipped_no_transcript = 0

    for jp in root.rglob("*.json"):
        if jp.name.startswith("_"):  # _summary.txt 등 보조 파일 방지
            continue
        code = _category_code(jp)
        if wanted and code not in wanted:
            continue
        try:
            d = json.loads(jp.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"[skip] JSON 파싱 실패 {jp.name}: {exc}", file=sys.stderr)
            continue

        transcript = (d.get("Transcript") or "").strip()
        if not transcript:
            skipped_no_transcript += 1
            continue

        pi = d.get("Patient_info", {}) or {}
        mi = d.get("Meta_info", {}) or {}
        di = d.get("Disease_info", {}) or {}
        file_id = d.get("File_id", "") or ""
        split = _split_of(jp)

        row = {
            "file_id": file_id,
            "split": split,
            "category_code": code,
            "category": CATEGORY_NAMES.get(code, code),
            "disease_type": di.get("Type", ""),
            "subcategory1": di.get("Subcategory1", ""),
            "sex": pi.get("Sex", ""),
            "age": pi.get("Age", ""),
            "area": pi.get("Area", ""),
            "sampling_rate": mi.get("SamplingRate", ""),
            "play_time_sec": d.get("playTime", mi.get("PlayTime", "")),
            "test_method": (d.get("Test_info", {}) or {}).get("TestMethod", ""),
            "transcript_len": len(transcript),
            "transcript": transcript,
            "label_relpath": str(jp.relative_to(root)).replace(os.sep, "/"),
            "expected_audio_relpath": _expected_audio_relpath(jp, root, file_id),
        }
        rows.append(row)
        cat_counter[code] += 1
        split_counter[split] += 1

    # 정렬: split → category → file_id
    rows.sort(key=lambda r: (r["split"], r["category_code"], r["file_id"]))

    suffix = ("_" + "-".join(sorted(wanted))) if wanted else "_all"
    jsonl_path = out_dir / f"manifest608{suffix}.jsonl"
    csv_path = out_dir / f"manifest608{suffix}.csv"

    with jsonl_path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # CSV는 transcript 제외(너무 길어 표 열람 방해) — 전사는 JSONL에만
    csv_fields = [k for k in rows[0].keys() if k != "transcript"] if rows else []
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=csv_fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print(f"✅ 매니페스트 {len(rows)}건 생성")
    print(f"   JSONL(전사 포함): {jsonl_path}")
    print(f"   CSV(전사 제외)  : {csv_path}")
    print(f"   split 분포     : {dict(split_counter)}")
    print("   카테고리 분포   :")
    for code, n in sorted(cat_counter.items()):
        print(f"      {code} {CATEGORY_NAMES.get(code, code)}: {n}")
    if skipped_no_transcript:
        print(f"   (전사 빈 항목 {skipped_no_transcript}건 제외)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
