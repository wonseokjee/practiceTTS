"""단어 세그먼트를 오디오 에너지로 재정렬한다 (whisper 재실행 불필요).

배경: `align_608 --wordlist`는 whisper 단어 타임스탬프를 앵커로 단어를 자른다.
그런데 단어 하나가 긴 침묵에 둘러싸인 608 단어검사 파일에서는 그 타임스탬프가
1~2초씩 밀린다(5차 배치 실측: 평균 +0.45초, 뒤쪽 편향). 클립 길이가 1.4초라
**25%가 단어를 통째로 놓쳤다** — 라벨은 '약'인데 오디오는 무음인 데이터다.
그대로 학습하면 모델이 무음에서 단어를 뱉도록 배운다.

단어들이 중앙값 9초씩 떨어져 있어(5분위 5.2초) 앵커 주변에서 에너지 피크를
찾는 게 안전하다. 탐색창은 이웃 세그먼트의 중점으로 클램프해 옆 단어를 훔치는
경우를 원천 차단한다.

**임계값은 파일별 상대값이다.** 절대 RMS로 자르면 조용한 화자가 통째로 날아간다
— 실측에서 75세·76세 여성 화자는 파일 전체 중앙 RMS가 50~62였다. 구음장애
인식에서 가장 필요한 집단을 데이터에서 지우는 셈이라, 각 파일의 바닥소음 대비로
판단한다.

사용:
  python scripts/asr_eval/refine_word_segments.py \
    --segments ".../_segs_big5/segments.jsonl" \
    --seg-root ".../_segs_big5" \
    --audio-root ".../608-audio-work/wav" \
    --out-dir ".../_segs_big5_refined"
"""
from __future__ import annotations

import argparse
import contextlib
import json
import subprocess
import sys
import wave
from collections import defaultdict
from pathlib import Path

import numpy as np

HOP_SEC = 0.02
"""RMS 프로파일 해상도. 단어 경계를 20ms까지 본다."""


def rms_profile(wav_path: Path, hop_sec: float = HOP_SEC) -> tuple[np.ndarray, float]:
    """부모 wav 전체의 RMS 프로파일을 만든다 → (프로파일, hop 초).

    24분짜리 44.1kHz 파일도 20ms 격자면 7만여 값이라 메모리에 올려도 된다.
    청크로 읽어 원본 전체를 한 번에 적재하지는 않는다(파일당 수백 MB).
    """
    with contextlib.closing(wave.open(str(wav_path), "rb")) as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        hop = max(1, int(sr * hop_sec))
        out: list[float] = []
        while True:
            raw = w.readframes(hop * 512)
            if not raw:
                break
            a = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
            if ch > 1:
                a = a.reshape(-1, ch).mean(axis=1)
            n = (len(a) // hop) * hop
            if n:
                out.extend(np.sqrt((a[:n].reshape(-1, hop) ** 2).mean(axis=1)))
    return np.asarray(out, dtype=np.float32), hop_sec


def refine_bounds(
    profile: np.ndarray,
    lo: int,
    hi: int,
    floor: float,
    *,
    rel_gate: float = 3.0,
    edge_frac: float = 0.15,
) -> tuple[int, int] | None:
    """[lo,hi) 탐색창에서 발화 구간을 찾아 (시작, 끝) 인덱스로 준다. 없으면 None.

    - 피크가 바닥소음의 `rel_gate`배에 못 미치면 발화가 없다고 보고 버린다.
      절대값이 아니라 파일별 바닥 대비라, 조용한 화자도 살아남는다.
    - 경계는 피크에서 좌우로 내려가다 `floor + (peak-floor)*edge_frac` 아래로
      떨어지는 지점이다. 침묵 한가운데 단어 하나라 이 방식이 잘 듣는다.
    """
    lo = max(0, lo)
    hi = min(len(profile), hi)
    if hi - lo < 2:
        return None
    win = profile[lo:hi]
    peak_i = int(win.argmax())
    peak = float(win[peak_i])
    if peak < floor * rel_gate:
        return None

    gate = floor + (peak - floor) * edge_frac
    s = peak_i
    while s > 0 and win[s - 1] > gate:
        s -= 1
    e = peak_i
    while e < len(win) - 1 and win[e + 1] > gate:
        e += 1
    return lo + s, lo + e + 1


def cut_wav(src: Path, start: float, end: float, dst: Path) -> bool:
    """ffmpeg로 [start,end]를 16kHz mono wav로 자른다(align_608과 같은 규격).

    `-ss`를 `-i` **앞에** 둔다(입력 탐색). 뒤에 두면 출력 탐색이라 24분짜리
    원본을 매번 처음부터 디코딩한다 — 파일당 수십 개를 자르므로 차이가 크다.
    길이는 `-to`(절대 시각) 대신 `-t`(구간 길이)로 준다. 입력 탐색 뒤에는
    타임스탬프 기준이 달라져 `-to`가 버전에 따라 다르게 해석되기 때문이다.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{max(0.0, end - start):.3f}",
        "-ac", "1", "-ar", "16000", str(dst),
    ]
    return subprocess.run(cmd, capture_output=True).returncode == 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        with contextlib.suppress(Exception):
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

    ap = argparse.ArgumentParser(description="단어 세그먼트 에너지 재정렬")
    ap.add_argument("--segments", required=True, type=Path)
    ap.add_argument("--audio-root", required=True, type=Path, help="부모 wav 루트")
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--search-sec", type=float, default=2.0, help="앵커 좌우 탐색 반경")
    ap.add_argument("--pad-sec", type=float, default=0.12, help="경계 앞뒤 여유")
    ap.add_argument("--min-sec", type=float, default=0.30)
    ap.add_argument("--max-sec", type=float, default=2.50)
    ap.add_argument("--rel-gate", type=float, default=3.0, help="바닥소음 대비 피크 배수")
    ap.add_argument("--dry-run", action="store_true", help="wav를 자르지 않고 통계만")
    ap.add_argument(
        "--words-max",
        type=int,
        default=1,
        help=(
            "이 단어 수 이하인 세그먼트만 재정렬한다(기본 1=단어만). 초과분은 손대지 "
            "않고 그대로 통과시킨다 — 문장은 내부에 자연스러운 쉼이 있어 같은 "
            "파라미터로 자르면 토막나기 때문이다. 0이면 전부 재정렬."
        ),
    )
    ap.add_argument(
        "--wordlist-file-frac",
        type=float,
        default=0.5,
        help=(
            "부모 파일의 세그먼트 중 1단어 비율이 이 값을 넘으면 그 파일을 단어검사 "
            "파일로 보고 task_type='wordlist'를 채운다. align_608이 파일 단위로 "
            "판정하는 것과 같은 층위다 — 세그먼트 하나만 보고 정하면 짧은 서술문이 "
            "오분류된다."
        ),
    )
    args = ap.parse_args()

    rows = [json.loads(l) for l in args.segments.open(encoding="utf-8") if l.strip()]
    by_parent: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_parent[r["parent_file_id"]].append(r)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / "segments.jsonl"
    kept = dropped = passed = 0
    before_hit = after_hit = 0
    shifts: list[float] = []

    def n_words(row: dict) -> int:
        return len((row.get("reference_text") or "").split())

    def copy_through(row: dict) -> None:
        """재정렬하지 않는 세그먼트의 wav를 산출 폴더로 그대로 옮긴다.

        이걸 빠뜨리면 매니페스트에는 줄이 있는데 wav가 없어, 패키징이 그 세그먼트를
        조용히 건너뛴다(실측: 문장 1723개 중 16개만 살아남았다). 통과 경로가 두
        군데(대상 없는 파일 / 파일 안의 문장 세그먼트)라 한 곳에 모은다.
        """
        if args.dry_run:
            return
        src_wav = args.segments.parent / row["segment_wav_relpath"]
        dst_wav = args.out_dir / row["segment_wav_relpath"]
        if src_wav.exists() and not dst_wav.exists():
            dst_wav.parent.mkdir(parents=True, exist_ok=True)
            dst_wav.write_bytes(src_wav.read_bytes())

    with out_path.open("w", encoding="utf-8") as out_f:
        for pi, (fid, segs) in enumerate(sorted(by_parent.items()), 1):
            src = args.audio_root / fid
            if not src.exists():
                print(f"[{pi}/{len(by_parent)}] {fid} 원본 없음 — 건너뜀")
                continue
            segs = sorted(segs, key=lambda r: r["start"])
            # 파일 단위 판정: 1단어 세그먼트가 대부분이면 단어검사 파일이다.
            # align_608도 파일 단위로 단어/문장 모드를 정한다 — 같은 층위로 맞춘다.
            word_frac = sum(n_words(r) == 1 for r in segs) / max(len(segs), 1)
            file_kind = "wordlist" if word_frac > args.wordlist_file_frac else "narrative"

            targets = [
                r for r in segs
                if args.words_max <= 0 or n_words(r) <= args.words_max
            ]
            if not targets:
                # 재정렬 대상이 없으면 프로파일을 만들 이유가 없다(파일당 수백 MB).
                for r in segs:
                    r = {**r, "task_type": r.get("task_type") or file_kind}
                    copy_through(r)
                    out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                    passed += 1
                print(f"[{pi}/{len(by_parent)}] {fid} — 대상 없음, {len(segs)}개 통과")
                continue

            prof, hop = rms_profile(src)
            # 바닥소음: 하위 10% 분위. 발화가 전체의 극히 일부라 안정적이다.
            floor = float(np.percentile(prof, 10)) or 1.0

            for i, r in enumerate(segs):
                r = {**r, "task_type": r.get("task_type") or file_kind}
                if args.words_max > 0 and n_words(r) > args.words_max:
                    # 문장 세그먼트는 손대지 않는다. wav도 원본을 그대로 옮겨
                    # 이 폴더 하나로 배치를 대체할 수 있게 한다.
                    copy_through(r)
                    out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                    passed += 1
                    continue

                # 탐색창을 이웃 세그먼트의 중점으로 클램프 — 옆 단어를 훔칠 수 없다.
                c = (r["start"] + r["end"]) / 2
                lo_t = c - args.search_sec
                hi_t = c + args.search_sec
                if i > 0:
                    lo_t = max(lo_t, (segs[i - 1]["end"] + r["start"]) / 2)
                if i + 1 < len(segs):
                    hi_t = min(hi_t, (r["end"] + segs[i + 1]["start"]) / 2)

                found = refine_bounds(
                    prof, int(lo_t / hop), int(hi_t / hop), floor, rel_gate=args.rel_gate
                )
                # 재정렬 전에 원래 클립이 피크를 담고 있었는지(개선 측정용)
                win = prof[max(0, int(lo_t / hop)) : max(1, int(hi_t / hop))]
                if win.size:
                    peak_t = (max(0, int(lo_t / hop)) + int(win.argmax())) * hop
                    if r["start"] <= peak_t <= r["end"]:
                        before_hit += 1
                if found is None:
                    dropped += 1
                    continue

                s = max(0.0, found[0] * hop - args.pad_sec)
                e = found[1] * hop + args.pad_sec
                if e - s < args.min_sec:
                    # 너무 짧으면 중심을 유지한 채 최소 길이로 넓힌다.
                    mid = (s + e) / 2
                    s, e = max(0.0, mid - args.min_sec / 2), mid + args.min_sec / 2
                if e - s > args.max_sec:
                    dropped += 1
                    continue

                new = dict(r)
                new["start"] = round(s, 3)
                new["end"] = round(e, 3)
                new["refined"] = True
                if s <= peak_t <= e:
                    after_hit += 1
                shifts.append(((s + e) / 2) - c)

                if not args.dry_run:
                    dst = args.out_dir / new["segment_wav_relpath"]
                    if not cut_wav(src, s, e, dst):
                        dropped += 1
                        continue
                out_f.write(json.dumps(new, ensure_ascii=False) + "\n")
                kept += 1

            print(
                f"[{pi}/{len(by_parent)}] {fid} ({file_kind}) — "
                f"누적 재정렬 {kept} · 버림 {dropped} · 통과 {passed}"
            )

    target_total = kept + dropped
    sh = np.asarray(shifts) if shifts else np.zeros(1)
    print()
    print(f"재정렬 대상 {target_total}개 → 유지 {kept} · 버림 {dropped} "
          f"({dropped / max(target_total,1):.0%})")
    print(f"손대지 않고 통과 {passed}개 (문장 세그먼트)")
    print(f"피크가 클립 안: 전 {before_hit / max(target_total,1):.0%} "
          f"→ 후 {after_hit / max(kept,1):.0%}")
    print(f"이동량(초): 중앙 {np.median(sh):+.2f} · 평균|이동| {np.abs(sh).mean():.2f}")
    print(f"산출: {out_path} (총 {kept + passed}줄)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
