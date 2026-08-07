"""베이스라인 ASR 평가 — 스플릿의 각 발화를 whisper로 인식해 CER/WER 측정.

Stage 0(측정)의 산출물: "개인화 이전, 범용 whisper가 이 병리 발화 코퍼스에서
얼마나 틀리는가"의 기준선. 이후 개인화가 이 숫자를 얼마나 낮추는지로 효과를
증명한다.

정렬(align_608)로 만든 문장 세그먼트 wav을 입력으로 받는 게 이상적이지만,
세그먼트가 없으면 원본 긴 wav 전체를 인식해 전체 전사와 비교한다(거친 기준선).

**오디오가 있어야 실측이 나온다.** 오디오가 없으면 무엇이 필요한지 안내하고
종료한다(합성 스모크 모드로 파이프라인 자체는 검증 가능: --smoke).

사용:
  python scripts/asr_eval/baseline_asr.py \
    --split "C:/.../_splits/test.jsonl" \
    --audio-root "C:/.../608-audio" \
    --model small --by-category

  # 오디오 없이 파이프라인만 스모크 검증(합성 인식기)
  python scripts/asr_eval/baseline_asr.py --split "C:/.../_splits/test.jsonl" --smoke
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import metrics as M  # noqa: E402
from split_speakers import speaker_of  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _load(split_path: Path) -> list[dict]:
    return [json.loads(l) for l in split_path.read_text(encoding="utf-8").splitlines() if l.strip()]


def _resolve_audio(row: dict, audio_root: Path) -> Path | None:
    """매니페스트 행 → 오디오 파일 경로. 없으면 None."""
    rel = row.get("expected_audio_relpath") or row.get("audio_relpath")
    if rel:
        p = audio_root / rel
        if p.exists():
            return p
    # 폴백: file_id로 재귀 탐색(캐시)
    fid = row["file_id"]
    for p in audio_root.rglob(fid):
        return p
    return None


def task_type(transcript: str) -> str:
    """전사를 과제 유형으로 분류: 'narrative'(서술문) | 'wordlist'(단어나열).

    이 코퍼스는 test_method가 전부 'Read aloud scripts'로 동일해 무용하다. 대신
    전사 구조로 나눈다 — 문장부호(.?!)가 3개 이상이면 서술문, 아니면 단어나열.
    과제 유형이 CER을 크게 가른다(문맥 없는 단어나열이 ASR에 훨씬 불리).
    """
    enders = sum(transcript.count(c) for c in ".?!")
    return "narrative" if enders >= 3 else "wordlist"


class WhisperRecognizer:
    """whisper 지연 로딩 래퍼. 첫 인식 때 모델을 올린다."""

    def __init__(self, model: str = "small", language: str = "ko"):
        self.model_name = model
        self.language = language
        self._model = None

    def __call__(self, audio_path: Path) -> str:
        if self._model is None:
            import whisper  # 지연 임포트(설치돼 있어야 함)

            self._model = whisper.load_model(self.model_name)
        # condition_on_previous_text=False: 앞 구간 텍스트를 다음 디코딩에 물려주지
        # 않는다. 병리 발화·짧은 구간에서 whisper가 같은 구절을 무한 반복하는 환각
        # (예: "…알라도 …알라도 …알라도")을 크게 줄인다. compression_ratio_threshold는
        # 기본(2.4)으로 두어 반복이 심한 세그먼트는 whisper가 스스로 폐기하게 한다.
        result = self._model.transcribe(
            str(audio_path),
            language=self.language,
            fp16=False,
            condition_on_previous_text=False,
        )
        return str(result.get("text", "")).strip()


def _smoke_recognizer(noise: float = 0.15):
    """오디오 없이 파이프라인을 검증하는 합성 인식기.

    정답에서 글자 일부를 지워 '가상 오인식'을 만든다. 실제 음향과 무관하며,
    집계/스플릿/출력 경로가 도는지만 본다.
    """
    import random

    rng = random.Random(0)

    def rec(reference: str) -> str:
        chars = [c for c in reference if rng.random() > noise]
        return "".join(chars)

    return rec


def evaluate(
    rows: list[dict],
    recognize,
    *,
    audio_root: Path | None,
    smoke: bool,
) -> dict:
    """각 발화를 인식→(가설, 정답) 수집→CER/WER 집계. 전체·질환별·화자별."""
    overall = M.ErrorStat(0, 0)
    overall_w = M.ErrorStat(0, 0)
    by_cat: dict[str, M.ErrorStat] = defaultdict(lambda: M.ErrorStat(0, 0))
    by_task: dict[str, M.ErrorStat] = defaultdict(lambda: M.ErrorStat(0, 0))
    n_scored = 0
    n_missing_audio = 0

    for r in rows:
        ref = r.get("transcript", "")
        if not ref:
            continue
        if smoke:
            hyp = recognize(ref)
        else:
            audio = _resolve_audio(r, audio_root) if audio_root else None
            if audio is None:
                n_missing_audio += 1
                continue
            hyp = recognize(audio)

        c = M.cer_stat(hyp, ref)
        w = M.wer_stat(hyp, ref)
        overall = overall + c
        overall_w = overall_w + w
        by_cat[r.get("category_code", "?")] += c
        by_task[task_type(ref)] += c
        n_scored += 1

    return {
        "scored": n_scored,
        "missing_audio": n_missing_audio,
        "cer": overall.rate,
        "wer": overall_w.rate,
        "by_category": {k: v.rate for k, v in sorted(by_cat.items())},
        "by_task": {k: v.rate for k, v in sorted(by_task.items())},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="베이스라인 ASR CER/WER 측정")
    ap.add_argument("--split", required=True, type=Path, help="test.jsonl 등 스플릿")
    ap.add_argument("--audio-root", type=Path, help="오디오 압축해제 루트")
    ap.add_argument("--model", default="small", help="whisper 모델 크기")
    ap.add_argument("--smoke", action="store_true", help="합성 인식기로 파이프라인만 검증")
    ap.add_argument("--limit", type=int, default=0, help="앞 N개만(빠른 확인)")
    args = ap.parse_args()

    rows = _load(args.split)
    if args.limit:
        rows = rows[: args.limit]

    if not args.smoke and not args.audio_root:
        print("오디오 루트(--audio-root)가 없습니다. 실측하려면 608 원천데이터")
        print("(VS01/TS01 등)를 받아 압축해제 후 경로를 주세요. 파이프라인만 확인하려면")
        print("--smoke 로 합성 인식기 스모크를 돌릴 수 있습니다.")
        sys.exit(2)

    recognize = _smoke_recognizer() if args.smoke else WhisperRecognizer(args.model)
    res = evaluate(rows, recognize, audio_root=args.audio_root, smoke=args.smoke)

    tag = "[SMOKE-합성]" if args.smoke else f"[whisper-{args.model}]"
    print(f"{tag} 채점 {res['scored']}발화" + (f" · 오디오없음 {res['missing_audio']}" if res["missing_audio"] else ""))
    print(f"  전체 CER {res['cer']:.3f} · WER {res['wer']:.3f}")
    print("  과제유형별 CER:", {k: round(v, 3) for k, v in res["by_task"].items()})
    print("  질환별 CER:", {k: round(v, 3) for k, v in res["by_category"].items()})
    if not args.smoke and res["scored"] == 0:
        print("  ⚠ 채점된 발화가 0 — 오디오 경로 매칭 실패(파일명/relpath 확인).")


if __name__ == "__main__":
    main()
