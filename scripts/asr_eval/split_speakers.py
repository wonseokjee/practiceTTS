"""화자 분리(speaker-disjoint) 평가 스플릿 빌더 + 누수 감사 + 데이터 예산 분석.

ASR 평가에서 가장 흔한 치명적 실수는 **같은 화자가 train과 test에 함께 들어가는
것**이다. 그러면 모델이 발음이 아니라 그 화자의 목소리를 외워, 오류율이 실제보다
훨씬 좋게 나온다(누수). 병리 발화는 화자 편차가 커서 이 누수의 왜곡이 특히 크다.

이 스크립트는 608 매니페스트에서:
  1. file_id에서 화자 코드를 뽑는다(포맷: ID-..-N-<SPEAKER>-..). 'N' 다음 토큰.
  2. **화자 단위**로 train/dev/test에 배정한다 → 한 화자는 한 split에만.
  3. AI Hub 기본 Train/Validation split이 화자를 누수시키는지 감사한다.
  4. 데이터 예산(화자 수, 화자별 발화·분량, 질환 분포)을 출력한다 —
     개인화 커브에 화자당 몇 분을 쓸 수 있는지 판단 근거.

오디오 없이 매니페스트만으로 동작한다(스플릿은 이후 베이스라인/개인화가 소비).

사용:
  python scripts/asr_eval/split_speakers.py \
    --manifest "C:/Users/wsji9/Downloads/608-labels/manifest608_all.jsonl" \
    --out-dir  "C:/Users/wsji9/Downloads/608-labels/_splits" \
    --test-speaker-frac 0.15 --dev-speaker-frac 0.10 --seed 42
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # 콘솔 cp949에서 한글 깨짐 방지


def speaker_of(file_id: str) -> str:
    """file_id에서 화자 코드 추출. 포맷 ID-..-N-<SPEAKER>-.. 의 'N' 다음 토큰.

    'N' 마커가 없으면(예외 포맷) 인덱스 4로 폴백. 어느 경우든 결정적이다.
    """
    toks = file_id.replace(".wav", "").split("-")
    for i, t in enumerate(toks[:-1]):
        if t == "N":
            return toks[i + 1]
    return toks[4] if len(toks) > 4 else file_id


def load_manifest(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


# ─── 데이터 예산 분석 ─────────────────────────────────────────────


@dataclass
class SpeakerBudget:
    speaker: str
    utterances: int = 0
    seconds: float = 0.0
    chars: int = 0
    category: str = ""
    sex: str = ""
    age: str = ""


def budgets(rows: list[dict]) -> dict[str, SpeakerBudget]:
    """화자별 발화 수·총 초·글자 수 집계."""
    out: dict[str, SpeakerBudget] = {}
    for r in rows:
        spk = speaker_of(r["file_id"])
        b = out.setdefault(spk, SpeakerBudget(spk))
        b.utterances += 1
        b.seconds += float(r.get("play_time_sec") or 0.0)
        b.chars += int(r.get("transcript_len") or 0)
        b.category = r.get("category_code", b.category)
        b.sex = r.get("sex", b.sex)
        b.age = r.get("age", b.age)
    return out


def audit_aihub_leakage(rows: list[dict]) -> dict:
    """AI Hub 기본 split(train/validation)이 화자를 공유하는지 감사."""
    by_split: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        by_split[r.get("split", "?")].add(speaker_of(r["file_id"]))
    splits = list(by_split)
    leaked: set[str] = set()
    for i in range(len(splits)):
        for j in range(i + 1, len(splits)):
            leaked |= by_split[splits[i]] & by_split[splits[j]]
    return {
        "splits": {s: len(v) for s, v in by_split.items()},
        "leaked_speakers": sorted(leaked),
        "leaked_count": len(leaked),
    }


# ─── 화자 분리 스플릿 ─────────────────────────────────────────────


@dataclass
class Split:
    train: list[str] = field(default_factory=list)
    dev: list[str] = field(default_factory=list)
    test: list[str] = field(default_factory=list)


def build_speaker_split(
    rows: list[dict],
    *,
    test_speaker_frac: float,
    dev_speaker_frac: float,
    seed: int,
) -> Split:
    """화자를 질환별로 층화해 train/dev/test에 배정(한 화자는 한 split만).

    층화(stratify): 질환 코드별로 화자를 나눠 각 split에 비슷한 비율로 들어가게
    한다 — 특정 질환이 test에만 몰리면 오류율이 왜곡되기 때문.
    """
    rng = random.Random(seed)
    by_cat: dict[str, list[str]] = defaultdict(list)
    seen: set[str] = set()
    for r in rows:
        spk = speaker_of(r["file_id"])
        if spk in seen:
            continue
        seen.add(spk)
        by_cat[r.get("category_code", "?")].append(spk)

    split = Split()
    for cat, speakers in sorted(by_cat.items()):
        speakers = sorted(speakers)
        rng.shuffle(speakers)
        n = len(speakers)
        n_test = round(n * test_speaker_frac)
        n_dev = round(n * dev_speaker_frac)
        split.test += speakers[:n_test]
        split.dev += speakers[n_test : n_test + n_dev]
        split.train += speakers[n_test + n_dev :]
    return split


def rows_for(rows: list[dict], speakers: set[str]) -> list[dict]:
    return [r for r in rows if speaker_of(r["file_id"]) in speakers]


def assert_disjoint(split: Split) -> None:
    """세 split의 화자 집합이 서로 겹치지 않음을 강제(누수 방지 불변식)."""
    t, d, e = set(split.train), set(split.dev), set(split.test)
    assert not (t & d), f"train∩dev 누수: {t & d}"
    assert not (t & e), f"train∩test 누수: {t & e}"
    assert not (d & e), f"dev∩test 누수: {d & e}"


# ─── CLI ─────────────────────────────────────────────────────────


def _fmt_min(sec: float) -> str:
    return f"{sec / 60:.1f}분"


def main() -> None:
    ap = argparse.ArgumentParser(description="608 화자 분리 스플릿 + 예산 분석")
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--out-dir", type=Path, help="스플릿 jsonl 출력 폴더(리포 밖 권장)")
    ap.add_argument("--test-speaker-frac", type=float, default=0.15)
    ap.add_argument("--dev-speaker-frac", type=float, default=0.10)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rows = load_manifest(args.manifest)
    buds = budgets(rows)
    total_sec = sum(b.seconds for b in buds.values())

    print(f"발화(파일): {len(rows)}  |  고유 화자: {len(buds)}")
    print(f"총 오디오: {_fmt_min(total_sec)} ({total_sec / 3600:.1f}시간)")

    utt = sorted((b.utterances for b in buds.values()))
    sec = sorted((b.seconds for b in buds.values()))
    mid = len(utt) // 2
    print(
        f"화자당 발화: 최소 {utt[0]} / 중앙 {utt[mid]} / 최대 {utt[-1]}"
        f"  |  화자당 분량: 중앙 {_fmt_min(sec[mid])} / 최대 {_fmt_min(sec[-1])}"
    )

    cats = Counter(b.category for b in buds.values())
    print("질환별 화자 수:", dict(sorted(cats.items())))

    leak = audit_aihub_leakage(rows)
    print(
        f"\n[감사] AI Hub 기본 split 화자 누수: {leak['leaked_count']}명"
        + (f" — {leak['leaked_speakers'][:8]}…" if leak["leaked_count"] else " (없음)")
    )
    print(f"       split별 화자 수: {leak['splits']}")

    split = build_speaker_split(
        rows,
        test_speaker_frac=args.test_speaker_frac,
        dev_speaker_frac=args.dev_speaker_frac,
        seed=args.seed,
    )
    assert_disjoint(split)

    def _stat(name: str, spks: list[str]) -> str:
        s = set(spks)
        rs = rows_for(rows, s)
        secs = sum(buds[x].seconds for x in s)
        return f"{name}: 화자 {len(s)} · 발화 {len(rs)} · {_fmt_min(secs)}"

    print("\n[화자 분리 스플릿] (한 화자는 한 split에만)")
    print("  " + _stat("train", split.train))
    print("  " + _stat("dev  ", split.dev))
    print("  " + _stat("test ", split.test))

    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        for name, spks in [("train", split.train), ("dev", split.dev), ("test", split.test)]:
            rs = rows_for(rows, set(spks))
            fp = args.out_dir / f"{name}.jsonl"
            with fp.open("w", encoding="utf-8") as f:
                for r in rs:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(f"  → {fp} ({len(rs)}행)")


if __name__ == "__main__":
    main()
