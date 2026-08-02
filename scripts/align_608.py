"""AI Hub 608 긴 낭독 오디오 → 문장 단위 정렬 세그먼트 변환기 (forced alignment v1).

608의 한 wav은 수 분짜리 긴 낭독이라(평균 2,273자), 앱의 짧은 단어/문장 채점에
바로 못 쓴다. 이 스크립트는 각 wav을 **정답 문장 단위**로 잘라, 문장별
{start, end, reference_text}와 잘라낸 wav을 만든다. 산출된 세그먼트는 그대로
/pronunciation(발음 평가) 입력이 된다.

정렬 방식 (추가 대용량 설치 없이 설치된 whisper만 사용):
  1. whisper( word_timestamps=True )로 인식 → 단어별 (text, start, end)
  2. 정답 전사(Transcript)를 문장으로 분할
  3. difflib로 whisper 단어열 ↔ 정답 단어열을 매칭해 앵커(정답단어→시각)를 잡는다
  4. 각 정답 문장의 시작/끝을 앵커로 계산(빠진 구간은 이웃 앵커로 보간)
  5. ffmpeg로 [start, end] 구간 wav을 잘라 저장 + 세그먼트 매니페스트 기록

한계: 병리 발화는 whisper 오인식이 잦다. 앵커+보간으로 완만히 열화하지만,
정밀 정렬이 필요하면 torchaudio MMS forced_align(별도 설치 ~1GB)으로 백엔드만
교체하면 된다(align_words 함수 대체).

사용 예:
  # 오디오(VS01 등) 압축해제 루트를 audio-root로. 매니페스트는 build_608_manifest 산출물.
  python scripts/align_608.py \
    --manifest "C:/Users/wsji9/Downloads/608-labels/manifest608_11-12.jsonl" \
    --audio-root "C:/Users/wsji9/Downloads/608-labels" \
    --model small --limit 5
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

_SENT_SPLIT = re.compile(r"(?<=[.?!。])\s+")
_WORD = re.compile(r"\S+")


def _sentences(text: str) -> list[str]:
    """정답 전사를 문장 단위로 분할(구분자 부족 시 통짜 1문장)."""
    parts = [s.strip() for s in _SENT_SPLIT.split(text.strip()) if s.strip()]
    return parts or ([text.strip()] if text.strip() else [])


def _norm(tok: str) -> str:
    """매칭용 정규화: 문장부호 제거, 소문자화."""
    return re.sub(r"[^\w가-힣]", "", tok).lower()


def align_words(audio_path: Path, model, language: str = "ko") -> list[dict]:
    """whisper로 단어별 타임스탬프를 얻는다 → [{text,start,end}, ...]."""
    result = model.transcribe(
        str(audio_path), language=language, word_timestamps=True, verbose=False
    )
    words: list[dict] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []) or []:
            words.append(
                {"text": w["word"].strip(), "start": float(w["start"]), "end": float(w["end"])}
            )
    return words


def _anchor_times(ref_tokens: list[str], hyp_words: list[dict]) -> dict[int, tuple[float, float]]:
    """정답 단어 index → (start,end) 앵커. whisper 단어와 매칭되는 것만."""
    ref_n = [_norm(t) for t in ref_tokens]
    hyp_n = [_norm(w["text"]) for w in hyp_words]
    sm = difflib.SequenceMatcher(a=ref_n, b=hyp_n, autojunk=False)
    anchors: dict[int, tuple[float, float]] = {}
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            hw = hyp_words[b + k]
            anchors[a + k] = (hw["start"], hw["end"])
    return anchors


def _interp(idx: int, anchors: dict[int, tuple[float, float]], total: int, which: int) -> float | None:
    """앵커가 없는 정답단어의 시각을 이웃 앵커로 근사(which: 0=start,1=end)."""
    if idx in anchors:
        return anchors[idx][which]
    # 왼쪽/오른쪽에서 가장 가까운 앵커
    left = max((i for i in anchors if i < idx), default=None)
    right = min((i for i in anchors if i > idx), default=None)
    if left is not None and right is not None:
        lt = anchors[left][1]
        rt = anchors[right][0]
        frac = (idx - left) / (right - left)
        return lt + (rt - lt) * frac
    if left is not None:
        return anchors[left][1]
    if right is not None:
        return anchors[right][0]
    return None


def segment_file(transcript: str, hyp_words: list[dict]) -> list[dict]:
    """정답 문장별 [start,end,text] 세그먼트를 만든다."""
    sents = _sentences(transcript)
    # 정답 전체 토큰과, 각 토큰이 속한 문장 index
    ref_tokens: list[str] = []
    tok_sent: list[int] = []
    for si, s in enumerate(sents):
        toks = _WORD.findall(s)
        ref_tokens.extend(toks)
        tok_sent.extend([si] * len(toks))
    if not ref_tokens or not hyp_words:
        return []

    anchors = _anchor_times(ref_tokens, hyp_words)
    if not anchors:
        return []

    segs: list[dict] = []
    for si, s in enumerate(sents):
        idxs = [i for i, t in enumerate(tok_sent) if t == si]
        if not idxs:
            continue
        start = _interp(idxs[0], anchors, len(ref_tokens), 0)
        end = _interp(idxs[-1], anchors, len(ref_tokens), 1)
        if start is None or end is None or end <= start:
            continue
        segs.append({"sent_index": si, "start": round(start, 3), "end": round(end, 3), "reference_text": s})
    return segs


def _cut_wav(src: Path, start: float, end: float, dst: Path) -> bool:
    """ffmpeg로 [start,end] 구간을 16kHz mono wav로 잘라 저장."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(src), "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
        "-ac", "1", "-ar", "16000", str(dst),
    ]
    return subprocess.run(cmd, capture_output=True).returncode == 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass

    ap = argparse.ArgumentParser(description="608 긴 낭독 → 문장 정렬 세그먼트")
    ap.add_argument("--manifest", required=True, help="build_608_manifest 산출 JSONL")
    ap.add_argument("--audio-root", required=True, help="오디오(원천데이터) 압축해제 루트")
    ap.add_argument("--out-dir", default="", help="세그먼트 산출 폴더 (기본: audio-root/_segments)")
    ap.add_argument("--model", default="small", help="whisper 모델 (tiny/base/small/medium)")
    ap.add_argument("--limit", type=int, default=0, help="처리할 파일 수 상한(0=전체)")
    ap.add_argument("--no-emit-wav", action="store_true", help="wav 절단 없이 타임스탬프만 기록")
    args = ap.parse_args()

    manifest = Path(args.manifest).resolve()
    audio_root = Path(args.audio_root).resolve()
    if not manifest.exists():
        print(f"[오류] 매니페스트 없음: {manifest}", file=sys.stderr)
        return 1
    out_dir = Path(args.out_dir).resolve() if args.out_dir else audio_root / "_segments"
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = [json.loads(l) for l in manifest.read_text(encoding="utf-8").splitlines() if l.strip()]

    # 오디오가 실제 존재하는 것만 처리
    present = []
    for r in rows:
        rel = r.get("expected_audio_relpath", "")
        if rel and (audio_root / rel).exists():
            present.append(r)
    print(f"매니페스트 {len(rows)}건 중 오디오 존재: {len(present)}건")
    if not present:
        print("→ 아직 오디오가 없습니다. VS01/TS01 압축해제 후 --audio-root를 그 루트로 지정해 다시 실행하세요.")
        return 0

    if args.limit:
        present = present[: args.limit]
        print(f"→ --limit {args.limit} 적용")

    import whisper  # 지연 임포트(오디오 없으면 모델 로드도 생략)
    print(f"whisper '{args.model}' 로드 중...")
    model = whisper.load_model(args.model)

    seg_manifest = out_dir / "segments.jsonl"
    total_segs = 0
    with seg_manifest.open("w", encoding="utf-8") as out:
        for i, r in enumerate(present, 1):
            src = audio_root / r["expected_audio_relpath"]
            print(f"[{i}/{len(present)}] {r['file_id']} 정렬 중...")
            try:
                hyp = align_words(src, model)
                segs = segment_file(r["transcript"], hyp)
            except Exception as exc:  # noqa: BLE001
                print(f"   [skip] 정렬 실패: {exc}", file=sys.stderr)
                continue
            stem = Path(r["file_id"]).stem
            for s in segs:
                seg_wav_rel = ""
                if not args.no_emit_wav:
                    dst = out_dir / stem / f"{stem}_{s['sent_index']:03d}.wav"
                    if _cut_wav(src, s["start"], s["end"], dst):
                        seg_wav_rel = str(dst.relative_to(out_dir)).replace("\\", "/")
                out.write(json.dumps({
                    "parent_file_id": r["file_id"],
                    "category": r.get("category", ""),
                    "sent_index": s["sent_index"],
                    "start": s["start"],
                    "end": s["end"],
                    "reference_text": s["reference_text"],
                    "segment_wav_relpath": seg_wav_rel,
                }, ensure_ascii=False) + "\n")
                total_segs += 1
            print(f"   → 세그먼트 {len(segs)}개")

    print(f"\n✅ 완료: 파일 {len(present)}건 → 세그먼트 {total_segs}개")
    print(f"   세그먼트 매니페스트: {seg_manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
