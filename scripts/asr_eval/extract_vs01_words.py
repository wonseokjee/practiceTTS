"""VS01 zip에서 **단어 파일만** 골라 뽑는다. 전체를 풀지 않는다.

왜 골라 뽑나: VS01은 압축 74.8GB인데 **풀면 155.3GB**다(wav가 2:1로 압축돼 있다).
우리가 쓰는 건 단어 264개뿐이고 그건 13.9GB다. 전체를 푸는 건 141GB를 버리려고
141GB를 쓰는 짓이다. 9차가 "같은 클립 반복은 값을 못 한다"를 닫았고 남은 길은
단어 화자를 늘리는 것이라(26 → 112명), 문장 941개는 받아도 쓸 데가 없다
(로컬에 미사용 문장이 이미 228.3h 있다).

**zip 안의 폴더 이름은 cp949로 인코딩돼 있다**(`11.중풍` 등). UTF-8 플래그가 없어서
파이썬이 cp437로 읽어 깨진 이름이 된다. 그래서 폴더 구조를 재현하지 않고
**파일명만 써서 평평하게** 뽑는다 — 파이프라인이 어차피 wav 폴더 하나를 보고,
파일명은 전부 ASCII다.

**AI Hub 다운로드는 zip이 아니라 tar다.** 안에 zip을 1 GiB씩 잘라 담았다:

    ././@LongLink                      <- GNU tar
    ...VS01_뇌신경장애.zip.part0            1 GiB
    ...VS01_뇌신경장애.zip.part1073741824   1 GiB   <- 이름이 곧 논리 오프셋
    ...                                    (75조각)

그냥 zipfile로 열면 **중앙 디렉터리는 읽히는데 파일을 꺼낼 때 터진다**
(`BadZipFile: Bad magic number for file header`) — 끝의 EOCD는 우연히 찾아지지만
조각 사이에 512바이트 tar 헤더가 끼어 있어 로컬 헤더 위치가 어긋나기 때문이다.
겉보기 목록이 멀쩡해서 더 헷갈린다.

조각을 디스크에 이어 붙이면 74.8GB를 한 번 더 써야 한다. 대신 **조각을 이어 붙인
가상 파일**(`_ConcatParts`)을 만들어 zipfile에 바로 먹인다 — 추가 디스크 0이다.

`.crdownload`(크롬 미완료 이름)에서도 그대로 읽는다. 전송만 끝났으면 구조는
온전하므로 이름을 바꾸거나 크롬에서 "유지"를 누를 필요가 없다.

중간에 끊겨도 다시 돌리면 된다 — 크기가 맞는 파일은 건너뛴다.

사용:
    python extract_vs01_words.py \
        --zip "~/Downloads/미확인 199194.crdownload" \
        --manifest ~/Downloads/608-labels/manifest608_all.jsonl \
        --dest E:/608-vs01-words
"""

from __future__ import annotations

import argparse
import bisect
import json
import os
import sys
import tarfile
import zipfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):          # 윈도우 cp949 콘솔 방어
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class _ConcatParts:
    """tar 안에 흩어진 zip 조각들을 하나의 seek 가능한 파일처럼 보이게 한다.

    zipfile은 seek/tell/read만 있으면 되므로 그 셋만 구현한다. 조각은 tar 안에서
    서로 떨어져 있지만(사이에 512바이트 헤더), 논리 오프셋상으로는 연속이다.
    """

    def __init__(self, path: Path, parts: list[tuple[int, int, int]]) -> None:
        # parts: (논리 시작, 길이, tar 안 파일 오프셋)
        self._f = open(path, "rb")
        self._parts = parts
        self._starts = [p[0] for p in parts]
        self._size = parts[-1][0] + parts[-1][1] if parts else 0
        self._pos = 0

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, off: int, whence: int = 0) -> int:
        self._pos = off if whence == 0 else self._pos + off if whence == 1 else self._size + off
        return self._pos

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            n = self._size - self._pos
        out = bytearray()
        while n > 0 and 0 <= self._pos < self._size:
            i = bisect.bisect_right(self._starts, self._pos) - 1
            start, length, foff = self._parts[i]
            within = self._pos - start
            take = min(n, length - within)
            self._f.seek(foff + within)
            chunk = self._f.read(take)
            if not chunk:
                break
            out += chunk
            self._pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def close(self) -> None:
        self._f.close()


def open_zip(path: Path):
    """zip 자체든, AI Hub의 'tar 안 zip 조각'이든 열어서 ZipFile을 준다."""
    with open(path, "rb") as f:
        head = f.read(512)
    if head[257:262] != b"ustar":
        return zipfile.ZipFile(path)          # 평범한 zip

    with tarfile.open(path, "r:") as tf:
        members = [m for m in tf.getmembers() if m.isfile()]
    if not members:
        raise SystemExit("tar인데 파일 멤버가 없다.")
    # 이름 끝의 partN이 논리 오프셋이다. 없으면 순서대로 이어 붙인다.
    parts: list[tuple[int, int, int]] = []
    cur = 0
    for m in sorted(members, key=lambda m: m.offset_data):
        tail = m.name.rsplit(".part", 1)
        start = int(tail[1]) if len(tail) == 2 and tail[1].isdigit() else cur
        parts.append((start, m.size, m.offset_data))
        cur = start + m.size
    parts.sort()
    # 조각이 논리적으로 연속인지 확인한다 — 어긋나면 조용히 깨진 zip을 읽게 된다.
    for (s1, l1, _), (s2, _, _) in zip(parts, parts[1:]):
        if s1 + l1 != s2:
            raise SystemExit(f"조각이 연속이 아니다: {s1}+{l1} != {s2}")
    print(f"  tar 안 zip 조각 {len(parts)}개를 이어 붙인다 ({cur / 2**30:.1f} GiB)")
    return zipfile.ZipFile(_ConcatParts(path, parts))


def task_type(transcript: str) -> str:
    """`baseline_asr.task_type`과 같은 규칙. 갈라지면 분류가 어긋난다."""
    return "narrative" if sum(transcript.count(c) for c in ".?!") >= 3 else "wordlist"


def main() -> None:
    ap = argparse.ArgumentParser(description="VS01에서 단어 wav만 뽑는다")
    ap.add_argument("--zip", required=True, type=Path)
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--dest", required=True, type=Path)
    ap.add_argument("--split", default="val")
    ap.add_argument("--kind", default="wordlist", choices=["wordlist", "narrative"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = [json.loads(l) for l in args.manifest.expanduser().open(encoding="utf-8")]
    want = {
        r["file_id"]
        for r in rows
        if r.get("split") == args.split and task_type(r.get("transcript") or "") == args.kind
    }
    if not want:
        raise SystemExit(f"매니페스트에 split={args.split} · {args.kind} 행이 없다.")

    zf = open_zip(args.zip.expanduser())
    members = [i for i in zf.infolist() if not i.is_dir() and os.path.basename(i.filename) in want]
    total = sum(i.file_size for i in members)
    print(f"zip   : {args.zip}")
    print(f"대상  : {args.kind} {len(members)}개 / 매니페스트 {len(want)}개")
    print(f"크기  : 풀면 {total / 2**30:.1f} GiB (압축 {sum(i.compress_size for i in members) / 2**30:.1f} GiB)")
    print(f"목적지: {args.dest}")

    if len(members) != len(want):
        miss = want - {os.path.basename(i.filename) for i in members}
        print(f"  [!] zip에 없는 파일 {len(miss)}개: {sorted(miss)[:3]} …")

    if args.dry_run:
        print("\n모의 실행이다. 실제로 뽑으려면 --dry-run 을 빼라.")
        return

    args.dest.mkdir(parents=True, exist_ok=True)
    done = skipped = 0
    written = 0
    for n, info in enumerate(sorted(members, key=lambda i: i.filename), 1):
        out = args.dest / os.path.basename(info.filename)
        if out.exists() and out.stat().st_size == info.file_size:
            skipped += 1
            continue
        with zf.open(info) as src, out.open("wb") as dst:
            while chunk := src.read(1 << 22):        # 4MB씩
                dst.write(chunk)
        done += 1
        written += info.file_size
        if n % 25 == 0 or n == len(members):
            print(f"  {n:4}/{len(members)}  ({written / 2**30:5.1f} GiB 기록)", flush=True)

    print(f"\n완료: 새로 {done}개 · 건너뜀 {skipped}개")
    got = sorted(p for p in args.dest.iterdir() if p.suffix.lower() == ".wav")
    print(f"목적지 wav {len(got)}개 · {sum(p.stat().st_size for p in got) / 2**30:.1f} GiB")
    if len(got) != len(want):
        print(f"  [!] 기대 {len(want)}개와 다르다. 다시 실행하면 빠진 것만 채운다.")


if __name__ == "__main__":
    main()
