"""보존된 앱 발화(speech_recordings) → 라벨 품질 필터 → 화자 분리 ASR 학습셋.

동의 기반으로 모인 환자 발화를 자체 ASR 학습셋으로 만든다. 핵심은 **라벨 오염
제거**(#11 옵션 D): target_text는 '말하라고 제시한 목표'라, 대상 환자(구음장애·
실어증)가 다르게 발화하면 오디오와 라벨이 어긋난다. 그래서 저장된 품질 메타로
거른다:
  - pronunciation: score(발음 정확도 0~100) >= --min-score 면 clean.
  - stt/naming/repeat/reading: recognized_text(ASR 가설)가 target에 충분히 가까우면
    (CER <= --max-label-cer) clean. 가설이 없으면 판단 불가 → weak.
  - 그 외는 weak(약라벨). 버리지 않고 별도 버킷으로 남겨 사람 전사/후처리에 쓴다.

clean만 화자 분리(patient_id=화자) train/dev/test로 나눈다. 한 화자는 한 split만
(누수 방지) — split_speakers와 같은 원칙.

입력은 speech_recordings의 JSONL export다(DB 결합을 피해 오프라인·테스트 가능).
DB에서 뽑는 예(psql):
  \\copy (SELECT patient_id, task, target_text, recognized_text, audio_path,
          score, duration_ms FROM speech_recordings) TO 'rec.jsonl' ...
또는 서버 관리 명령으로 JSONL을 만들어 이 스크립트에 넘긴다.

산출물(--out-dir):
  train.jsonl / dev.jsonl / test.jsonl  — {audio, text, patient, task}
  weak.jsonl                            — 걸러진 약라벨(사람 검수 대상)
  전사(PII)를 담으므로 리포 밖에 두고 커밋 금지.

사용:
  python scripts/asr_eval/build_training_set.py \
    --recordings rec.jsonl --audio-root "../speech-data" --out-dir _trainset \
    --min-score 70 --max-label-cer 0.2 --seed 42
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import metrics as M  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 목표와 가설을 비교해 라벨을 신뢰할지 정하는 과제군(자유 인식 계열).
_HYP_TASKS = {"stt", "naming", "repeat", "reading"}


def _get(row: dict, *keys: str):
    """snake_case/camelCase 어느 export든 받도록 여러 키를 순서대로 시도."""
    for k in keys:
        if k in row and row[k] is not None:
            return row[k]
    return None


def classify_label(row: dict, *, min_score: float, max_label_cer: float) -> str:
    """행의 라벨 신뢰도를 판정: 'clean' | 'weak'.

    - 목표 텍스트가 없으면 학습 불가 → weak.
    - pronunciation: 점수가 임계 이상이면 clean(목표에 근접해 발음).
    - 자유 인식 과제: 가설이 target에 CER 임계 이하로 가까우면 clean.
    - 판단 근거(점수/가설)가 없으면 weak.
    """
    target = (_get(row, "target_text", "targetText") or "").strip()
    if not target:
        return "weak"
    task = _get(row, "task") or ""
    score = _get(row, "score")
    recognized = (_get(row, "recognized_text", "recognizedText") or "").strip()

    if task == "pronunciation":
        if isinstance(score, (int, float)) and score >= min_score:
            return "clean"
        # 점수가 있는데 낮으면 오염 가능 → weak. 점수 자체가 없어도 판단불가 → weak.
        return "weak"

    if task in _HYP_TASKS:
        if not recognized:
            return "weak"
        cer = M.cer_stat(recognized, target).rate
        return "clean" if cer <= max_label_cer else "weak"

    return "weak"


def speaker_of(row: dict) -> str:
    """화자 = patient_id(앱 발화는 환자 계정이 곧 화자)."""
    return str(_get(row, "patient_id", "patientId") or "unknown")


def build_split(
    speakers: list[str], *, test_frac: float, dev_frac: float, seed: int
) -> dict[str, set[str]]:
    """화자를 train/dev/test로 배정(한 화자는 한 split만)."""
    rng = random.Random(seed)
    uniq = sorted(set(speakers))
    rng.shuffle(uniq)
    n = len(uniq)
    n_test = round(n * test_frac)
    n_dev = round(n * dev_frac)
    return {
        "test": set(uniq[:n_test]),
        "dev": set(uniq[n_test : n_test + n_dev]),
        "train": set(uniq[n_test + n_dev :]),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="보존 발화 → 라벨 품질 필터 학습셋")
    ap.add_argument("--recordings", required=True, type=Path, help="speech_recordings JSONL export")
    ap.add_argument("--audio-root", type=Path, help="SPEECH_DATA_DIR(오디오 존재 확인용)")
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--min-score", type=float, default=70, help="발음 clean 임계(0~100)")
    ap.add_argument("--max-label-cer", type=float, default=0.2, help="가설↔목표 clean 임계 CER")
    ap.add_argument("--test-frac", type=float, default=0.15)
    ap.add_argument("--dev-frac", type=float, default=0.10)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rows = [
        json.loads(l)
        for l in args.recordings.read_text(encoding="utf-8").splitlines()
        if l.strip()
    ]

    clean: list[dict] = []
    weak: list[dict] = []
    n_missing_audio = 0
    for r in rows:
        rel = _get(r, "audio_path", "audioPath")
        if args.audio_root and rel and not (args.audio_root / rel).exists():
            n_missing_audio += 1
            continue
        label = classify_label(
            r, min_score=args.min_score, max_label_cer=args.max_label_cer
        )
        rec = {
            "audio": rel,
            "text": (_get(r, "target_text", "targetText") or "").strip(),
            "patient": speaker_of(r),
            "task": _get(r, "task"),
            "recognized": _get(r, "recognized_text", "recognizedText"),
            "score": _get(r, "score"),
        }
        (clean if label == "clean" else weak).append(rec)

    print(f"입력 {len(rows)}행" + (f" · 오디오없음 {n_missing_audio}(제외)" if n_missing_audio else ""))
    print(f"clean {len(clean)} · weak {len(weak)}")
    print("clean 과제별:", dict(Counter(r["task"] for r in clean)))
    print("weak 과제별 :", dict(Counter(r["task"] for r in weak)))

    speakers = [r["patient"] for r in clean]
    split = build_split(
        speakers, test_frac=args.test_frac, dev_frac=args.dev_frac, seed=args.seed
    )
    # 누수 방지 불변식
    assert not (split["train"] & split["dev"])
    assert not (split["train"] & split["test"])
    assert not (split["dev"] & split["test"])

    buckets: dict[str, list[dict]] = defaultdict(list)
    for r in clean:
        for name in ("train", "dev", "test"):
            if r["patient"] in split[name]:
                buckets[name].append(r)
                break

    args.out_dir.mkdir(parents=True, exist_ok=True)

    def _write(name: str, items: list[dict]) -> None:
        fp = args.out_dir / f"{name}.jsonl"
        with fp.open("w", encoding="utf-8") as f:
            for it in items:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
        spk = len({it["patient"] for it in items})
        print(f"  {name}: {len(items)}발화 · 화자 {spk} → {fp}")

    print("\n[학습셋] (clean만, 화자 분리)")
    for name in ("train", "dev", "test"):
        _write(name, buckets[name])
    _write("weak", weak)


if __name__ == "__main__":
    main()
