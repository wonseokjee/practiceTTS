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


DEFAULT_DEV_SPEAKER_FRAC = 0.1
"""고르기용(dev) 화자 비율의 기본값. **0이면 안 된다.**

0이던 동안 dev 스플릿이 없었고, 노트북이 test를 에포크 평가·최고 체크포인트
선택·최종 보고에 모두 썼다. 그 결과 1~6차 배치의 CER은 홀드아웃 성능이 아니라
시험지를 보며 고른 점수였다(`docs/asr/608-finetune-log.md` 경고 절).

0.1인 이유: test 0.2보다 작게 잡아 학습 데이터를 덜 깎으면서도, 화자 20~30명
규모에서 dev가 2~3명은 되게 한다. 1명이면 그 화자의 특성이 체크포인트 선택을
통째로 좌우한다.
"""


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
    """화자 → split 매핑(한 화자는 한 split만).

    주의: 이 함수는 매 호출마다 전체 화자 집합을 다시 셔플한다. random.shuffle은
    입력 길이가 바뀌면 같은 seed로도 다른 순열을 낸다 — 즉 배치를 병합해 화자
    수가 달라질 때마다 이전에 train이던 화자가 test로(또는 그 반대로) 넘어갈 수
    있다. 배치 간 재현성이 필요하면 이 함수를 직접 쓰지 말고
    `split_speakers_persisted`를 쓴다(기존 배정을 파일에 봉인해 재사용).
    """
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


def split_speakers_persisted(
    speakers: list[str],
    *,
    test_frac: float,
    dev_frac: float,
    seed: int,
    split_file: Path,
) -> dict[str, str]:
    """split_speakers()의 봉인 버전 — 화자→split 배정을 split_file에 영속화하고,
    이후 호출은 기존 배정을 절대 바꾸지 않는다(신규 화자만 추가 배정).

    이게 없으면: 배치를 병합할 때마다 전체 화자 집합이 커지고, split_speakers()가
    매번 처음부터 재셔플해 기존 화자가 train↔test를 넘나든다 — 배치 간 CER
    비교가 무의미해지고, 심하면 이전에 학습에 쓰인 화자가 다음 평가의 test로
    들어가는 실질적 데이터 누수가 된다.
    """
    existing: dict[str, str] = {}
    if split_file.exists():
        existing = json.loads(split_file.read_text(encoding="utf-8"))

    uniq = sorted(set(speakers))
    new_speakers = [s for s in uniq if s not in existing]

    if not existing:
        # 최초 실행: 기존 split_speakers()와 동일한 로직으로 전체 배정.
        assign = split_speakers(uniq, test_frac=test_frac, dev_frac=dev_frac, seed=seed)
    else:
        assign = dict(existing)
        if new_speakers:
            # 신규 화자만 셔플해 배정한다. 목표 비율은 "갱신된 전체 집합" 기준으로
            # 다시 계산하되, 기존 배정은 절대 건드리지 않고 신규 화자로만 채운다.
            rng = random.Random(seed)
            rng.shuffle(new_speakers)
            total_n = len(existing) + len(new_speakers)
            target_test = round(total_n * test_frac)
            target_dev = round(total_n * dev_frac)
            cur_test = sum(1 for v in existing.values() if v == "test")
            cur_dev = sum(1 for v in existing.values() if v == "dev")
            need_test = max(0, target_test - cur_test)
            need_dev = max(0, target_dev - cur_dev)
            for i, s in enumerate(new_speakers):
                if i < need_test:
                    assign[s] = "test"
                elif i < need_test + need_dev:
                    assign[s] = "dev"
                else:
                    assign[s] = "train"

    split_file.parent.mkdir(parents=True, exist_ok=True)
    split_file.write_text(
        json.dumps(assign, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(
        f"  화자 split: 기존 {len(existing)}명 유지 + 신규 {len(new_speakers)}명 배정 "
        f"→ {split_file}"
    )
    return assign


def main() -> None:
    ap = argparse.ArgumentParser(description="608 세그먼트 → Colab 학습셋")
    ap.add_argument("--segments", required=True, type=Path)
    ap.add_argument("--seg-root", required=True, type=Path, help="segment_wav_relpath 기준 루트")
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--test-speaker-frac", type=float, default=0.2)
    ap.add_argument(
        "--dev-speaker-frac",
        type=float,
        default=DEFAULT_DEV_SPEAKER_FRAC,
        help=(
            "고르기용(dev) 화자 비율. **0으로 두면 안 된다** — 그러면 노트북이 test로 "
            "최고 체크포인트를 골라 보고 수치가 홀드아웃이 아니게 된다. "
            "근거는 DEFAULT_DEV_SPEAKER_FRAC 독스트링 참고."
        ),
    )
    ap.add_argument("--min-sec", type=float, default=1.0)
    ap.add_argument("--max-sec", type=float, default=30.0)
    ap.add_argument("--zip", action="store_true", help="업로드용 zip도 생성")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument(
        "--split-file",
        type=Path,
        default=None,
        help=(
            "화자→split 배정을 영속화할 JSON 경로. 배치 병합 때마다 재셔플로 화자가 "
            "train↔test를 넘나드는 것을 막는다. 기본값: --seg-root의 상위 폴더 "
            "(out-dir이 아니다 — out-dir은 배치마다 바뀌지만 seg-root의 상위는 "
            "608-audio-work처럼 배치 전체가 공유하는 고정 작업 루트다). "
            "빈 문자열('')을 주면 예전처럼 매번 재셔플(비권장, 디버깅용)."
        ),
    )
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
    # --split-file '' 이면 예전 방식(매번 재셔플, 비권장). 기본은 seg-root의
    # 상위(배치 전체가 공유하는 고정 작업 루트)에 speaker_split.json으로 봉인.
    if args.split_file is not None and str(args.split_file) == "":
        assign = split_speakers(
            speakers,
            test_frac=args.test_speaker_frac,
            dev_frac=args.dev_speaker_frac,
            seed=args.seed,
        )
    else:
        split_file = args.split_file or (args.seg_root.parent / "speaker_split.json")
        assign = split_speakers_persisted(
            speakers,
            test_frac=args.test_speaker_frac,
            dev_frac=args.dev_speaker_frac,
            seed=args.seed,
            split_file=split_file,
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
            {
                "audio": rel.as_posix(),
                "text": s["reference_text"].strip(),
                # 구 배치(task_type 필드 도입 전, 전부 문장 모드였음)는 narrative로 채운다.
                "task_type": s.get("task_type", "narrative"),
            }
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
        n_word = sum(1 for it in items if it["task_type"] == "wordlist")
        print(
            f"  {split}: {len(items)}개(단어 {n_word}·문장 {len(items) - n_word}) "
            f"· 화자 {spk} → {fp.name}"
        )

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
