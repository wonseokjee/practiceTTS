"""목표 단어 검증 사례 파일(`golden/target_verification_cases.json`)을 만든다.

홀드아웃 평가셋의 공정 행(원래 dev·test, 457개)마다 목표 단어와 근접 foil(다른 실제 단어) 목록을
적는다. Colab 노트북은 이 파일과 평가 노트북이 이미 저장한 자유 받아쓰기(preds)를 읽어 채점만 한다.

- foil: `build_target_foils.build_foils`(앱 표적 단어 기준, 시드 42) — 오통과 시험 재료
- 정답으로 보는 변형(부분 명칭 등)은 음성에서 뺀다: `azure_neighbor_eval.is_accepted_variant`
  (앱 `neighborScoring.ts`와 골든 벡터로 묶인 정의)

실행:
    python scripts/asr_eval/build_verification_cases.py            # 쓴다
    python scripts/asr_eval/build_verification_cases.py --check    # 낡았는지만 본다
    python scripts/asr_eval/build_verification_cases.py --azure-fr # Azure 기준선 → 노트북 입력

Azure 기준선(판정의 "현행보다 오판정이 낮은가"): 같은 test 행을 Azure 발음 평가로 잰다.
    python scripts/asr_eval/azure_eval.py --mode pa --split <홀드아웃>/holdout_fair_test.jsonl --yes
그 캐시에서 오판정률을 내 `whisper-608-vochold-azure-fr.json`을 쓴다 — 드라이브 루트에 올린다.
오판정률 = 탈락 ÷ 채점된 것(점수 없음은 앱이 채점을 안 하므로 분모에서 뺀다, 4-2절과 같은 정의).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import azure_foil_eval as AF  # noqa: E402
import azure_neighbor_eval as NE  # noqa: E402
import build_target_foils as F  # noqa: E402
import target_verification as T  # noqa: E402

HOLDOUT = Path(os.path.expanduser("~/Downloads/608-audio-work/colab_trainset_big7_vochold"))
OUT = HERE / "golden" / "target_verification_cases.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def build(holdout: Path = HOLDOUT) -> dict:
    rows = [json.loads(l) for l in (holdout / "holdout_eval.jsonl").open(encoding="utf-8") if l.strip()]
    words = sorted({r["text"].strip() for r in rows})
    foils = F.build_foils(words, F.load_pool(F.DEFAULT_POOL), F.load_categories(F.DEFAULT_BANK))
    cases = T.build_cases(rows, foils, NE.is_accepted_variant)
    return {
        "version": 1,
        "source": "holdout_eval.jsonl (colab_trainset_big7_vochold), 공정 행(orig_split dev·test)",
        "foils": "build_target_foils seed 42 전 종류, counts=counts_for_fa(음운·의미 근접), 정답 변형 제외",
        "cases": cases,
    }


def azure_fr(holdout: Path = HOLDOUT) -> dict:
    """같은 test 행의 Azure 오판정률. 캐시에 없는 행이 하나라도 있으면 멈춘다(부분 기준선 금지)."""
    rows = [json.loads(l) for l in (holdout / "holdout_fair_test.jsonl").open(encoding="utf-8") if l.strip()]
    cache = AF.AE.load_cache(holdout / "_azure_pa_cache.jsonl")
    missing = [r["audio"] for r in rows if r["audio"] not in cache]
    if missing:
        raise SystemExit(f"Azure 캐시에 없는 행 {len(missing)}개 — azure_eval.py --mode pa를 먼저 끝내라")
    oc = [AF.app_outcome(cache[r["audio"]]) for r in rows]
    scored = [o for o in oc if o != "unscored"]
    return {"test_fr": oc.count("fail") / len(scored), "n": len(rows), "scored": len(scored),
            "unscored": oc.count("unscored"), "definition": "fail / scored, accuracy >= 60 통과"}


def render(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="목표 단어 검증 사례 파일을 만든다")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--azure-fr", action="store_true", help="Azure 기준선 파일을 ~/Downloads에 쓴다")
    args = ap.parse_args()
    if args.azure_fr:
        fr = azure_fr()
        out = Path(os.path.expanduser("~/Downloads/whisper-608-vochold-azure-fr.json"))
        out.write_text(json.dumps(fr, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Azure 오판정률 {fr['test_fr']:.1%} (채점 {fr['scored']} · 점수 없음 {fr['unscored']}) → {out}")
        return 0
    want = render(build())
    if args.check:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == want
        print("최신이다" if ok else "낡았다 — 다시 만들어라", OUT)
        return 0 if ok else 1
    OUT.write_text(want, encoding="utf-8", newline="\n")
    data = json.loads(want)
    neg = sum(len(c["candidates"]) - 1 for c in data["cases"])
    print(f"{OUT} · 사례 {len(data['cases'])}개 · foil 쌍 {neg}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
