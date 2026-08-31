"""정렬용 부모 wav를 16kHz 모노 16비트로 통일한다.

**왜 미리 바꾸나**: `align_608`도 `refine_segments`도 세그먼트를 잘라 저장할 때
`ffmpeg -ac 1 -ar 16000`을 쓴다. 즉 최종 산출은 어차피 16k 모노다(기존 학습
세그먼트 3024개가 전부 16000/1/2다). 부모를 미리 바꿔 두면 **결과가 같으면서**
두 가지를 얻는다:

  1. **크기가 3.1배 준다** (VS01 단어 264개 기준 13.9GiB → 4.4GiB).
     Colab에서 정렬하려면 드라이브로 올려야 하는데 이게 업로드 시간을 좌우한다.
  2. **포맷 편차가 사라진다.** VS01에는 24비트 5개·32비트 5개·스테레오 30개가
     섞여 있었고 그게 `rms_profile`을 깨뜨렸다. 입구에서 통일하면 하류 도구가
     비트 깊이를 만날 일이 없다(수정은 그대로 두되, 안전망이 된다).

이중 리샘플링이 아니다 — 뒤의 ffmpeg 호출은 16k→16k라 무연산이다.

사용:
    python to16k_mono.py --src <원본 루트> --dst <출력 루트>      # 구조 유지
    python to16k_mono.py --src ... --dst ... --flat               # 평평하게
"""

from __future__ import annotations

import argparse
import contextlib
import subprocess
import sys
import wave
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def probe(p: Path) -> tuple[int, int, int] | None:
    try:
        with contextlib.closing(wave.open(str(p), "rb")) as w:
            return w.getframerate(), w.getnchannels(), w.getsampwidth()
    except Exception:
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description="부모 wav를 16k 모노 16비트로")
    ap.add_argument("--src", required=True, type=Path)
    ap.add_argument("--dst", required=True, type=Path)
    ap.add_argument("--flat", action="store_true", help="폴더 구조 없이 파일명만")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src = args.src.expanduser()
    files = sorted(src.rglob("*.wav"))
    if not files:
        raise SystemExit(f"{src} 아래에 wav가 없다.")

    todo, already = [], 0
    for p in files:
        fmt = probe(p)
        if fmt == (16000, 1, 2):
            already += 1
        todo.append(p)
    print(f"원본 {len(files)}개 (이미 16k 모노: {already}개)")
    print(f"  {src}  →  {args.dst}{' (평평)' if args.flat else ''}")
    if args.dry_run:
        print("모의 실행이다.")
        return

    args.dst.mkdir(parents=True, exist_ok=True)
    done = skipped = 0
    for n, p in enumerate(todo, 1):
        out = args.dst / p.name if args.flat else args.dst / p.relative_to(src)
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists() and probe(out) == (16000, 1, 2):
            skipped += 1
            continue
        # -sample_fmt s16 을 명시한다. 안 주면 입력이 24/32비트일 때 그대로 따라가
        # 하류에서 또 비트 깊이를 만난다.
        r = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(p),
             "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", str(out)],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  [!] 실패 {p.name}: {r.stderr.strip()[:120]}")
            continue
        done += 1
        if n % 25 == 0 or n == len(todo):
            print(f"  {n:4}/{len(todo)}", flush=True)

    outs = sorted(args.dst.rglob("*.wav"))
    fmts = {}
    total = 0
    for p in outs:
        fmts[probe(p)] = fmts.get(probe(p), 0) + 1
        total += p.stat().st_size
    print(f"\n변환 {done} · 건너뜀 {skipped}")
    print(f"결과 {len(outs)}개 · {total / 2**30:.2f} GiB · 포맷 {fmts}")
    if len(fmts) != 1 or (16000, 1, 2) not in fmts:
        print("  [!] 포맷이 하나로 통일되지 않았다.")


if __name__ == "__main__":
    main()
