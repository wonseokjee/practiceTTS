"""개인화 커브 — "화자의 발화를 N분 적응시키면 오류가 얼마나 줄어드는가".

Stage 1(개인화 곡선)의 산출물. test 화자별로 그 화자의 발화를 시간순/랜덤으로
쌓아가며 [0, k1, k2, …]분을 적응(adaptation)에 쓰고, 남긴 홀드아웃 발화에서
CER을 잰다. x축=적응 분량, y축=CER 커브를 화자별·평균으로 그린다.

이 커브가 제품 결정을 좌우한다:
  - 커브가 몇 분 만에 꺾이면 → 온보딩에서 짧게 녹음받아 즉시 개인화(가치 큼)
  - 완만하면 → 개인화보다 범용 모델 강화가 먼저

적응 방식은 교체 가능(adapter 인자):
  - 기본 스텁: 적응량이 늘수록 오류가 단조 감소하는 **가상 커브**(파이프라인 검증용)
  - 실제: whisper 파인튜닝/LoRA 또는 얕은 융합 등을 여기에 끼운다.

**실제 곡선은 오디오 + 적응 백엔드가 있어야 나온다.** 지금은 스플릿·홀드아웃·
집계·리포트 구조를 고정하고, --sim 으로 형태를 예시한다.

사용:
  python scripts/asr_eval/personalization_curve.py \
    --test-split "C:/.../_splits/test.jsonl" \
    --minutes 0,1,3,5,10 --sim
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from split_speakers import speaker_of, budgets  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _load(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def group_by_speaker(rows: list[dict]) -> dict[str, list[dict]]:
    g: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        g[speaker_of(r["file_id"])].append(r)
    return g


def split_adapt_holdout(
    utterances: list[dict], adapt_minutes: float
) -> tuple[list[dict], list[dict]]:
    """화자 발화를 정렬해 앞에서부터 adapt_minutes만큼 적응용으로, 나머지는 홀드아웃.

    누수 방지: 적응에 쓴 발화는 절대 평가에 쓰지 않는다.
    """
    utts = sorted(utterances, key=lambda r: r["file_id"])
    budget = adapt_minutes * 60.0
    used = 0.0
    adapt: list[dict] = []
    holdout: list[dict] = []
    for r in utts:
        dur = float(r.get("play_time_sec") or 0.0)
        if used < budget:
            adapt.append(r)
            used += dur
        else:
            holdout.append(r)
    return adapt, holdout


def simulated_adapter(baseline_cer: float = 0.42, floor: float = 0.12, tau: float = 4.0):
    """가상 적응기: 적응 분량 m에 대해 CER = floor + (baseline-floor)*exp(-m/tau).

    실제 적응 백엔드를 끼우기 전, 커브의 형태와 리포트를 검증하기 위한 스텁.
    tau는 '반감 시간' 느낌의 상수(작을수록 빨리 꺾임).
    """
    import math

    def adapt_and_eval(adapt: list[dict], holdout: list[dict], adapt_minutes: float) -> float | None:
        if not holdout:
            return None  # 홀드아웃이 없으면 그 지점은 이 화자에서 측정 불가
        return floor + (baseline_cer - floor) * math.exp(-adapt_minutes / tau)

    return adapt_and_eval


def curve(
    rows: list[dict],
    minutes: list[float],
    adapter,
    *,
    min_holdout: int = 1,
) -> dict:
    """화자별로 각 적응 분량에서 홀드아웃 CER을 재고, 분량별로 화자 평균."""
    by_speaker = group_by_speaker(rows)
    per_point: dict[float, list[float]] = {m: [] for m in minutes}
    per_speaker: dict[str, dict[float, float]] = {}

    for spk, utts in by_speaker.items():
        row_curve: dict[float, float] = {}
        for m in minutes:
            adapt, holdout = split_adapt_holdout(utts, m)
            if len(holdout) < min_holdout:
                continue
            cer = adapter(adapt, holdout, m)
            if cer is not None:
                row_curve[m] = cer
                per_point[m].append(cer)
        if row_curve:
            per_speaker[spk] = row_curve

    mean_curve = {
        m: (sum(v) / len(v) if v else None) for m, v in per_point.items()
    }
    return {
        "minutes": minutes,
        "mean_cer": mean_curve,
        "n_speakers_per_point": {m: len(v) for m, v in per_point.items()},
        "per_speaker": per_speaker,
    }


def _sparkline(values: list[float | None]) -> str:
    blocks = "▁▂▃▄▅▆▇█"
    nums = [v for v in values if v is not None]
    if not nums:
        return ""
    lo, hi = min(nums), max(nums)
    out = []
    for v in values:
        if v is None:
            out.append(" ")
        elif hi == lo:
            out.append(blocks[0])
        else:
            out.append(blocks[int((v - lo) / (hi - lo) * (len(blocks) - 1))])
    return "".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description="개인화 커브(적응 분량↑ → CER)")
    ap.add_argument("--test-split", required=True, type=Path)
    ap.add_argument("--minutes", default="0,1,3,5,10", help="적응 분량 지점(쉼표)")
    ap.add_argument("--sim", action="store_true", help="가상 적응기로 커브 형태 예시")
    ap.add_argument("--out", type=Path, help="커브 JSON 저장 경로")
    args = ap.parse_args()

    minutes = [float(x) for x in args.minutes.split(",")]
    rows = _load(args.test_split)

    if not args.sim:
        print("실제 적응 백엔드가 아직 없습니다. 지금은 --sim 으로 커브 형태·리포트를")
        print("검증할 수 있습니다. 실측하려면 오디오 + 적응기(파인튜닝/LoRA)를 붙여")
        print("simulated_adapter 자리를 실제 adapt_and_eval 로 교체하세요.")
        sys.exit(2)

    result = curve(rows, minutes, simulated_adapter())

    print(f"[SIM] test 화자 {len(result['per_speaker'])}명 · 적응지점 {minutes}(분)")
    mean_vals = [result["mean_cer"][m] for m in minutes]
    print("  평균 CER:", {m: (round(v, 3) if v is not None else None) for m, v in result["mean_cer"].items()})
    print("  커브     :", _sparkline(mean_vals), "(왼쪽=0분, 오른쪽 갈수록 적응↑)")
    print("  지점별 화자수:", result["n_speakers_per_point"])
    if len(minutes) >= 2 and mean_vals[0] and mean_vals[-1]:
        drop = (mean_vals[0] - mean_vals[-1]) / mean_vals[0] * 100
        print(f"  0분→{minutes[-1]:.0f}분 CER {drop:.0f}% 감소(가상)")

    if args.out:
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  → {args.out}")


if __name__ == "__main__":
    main()
