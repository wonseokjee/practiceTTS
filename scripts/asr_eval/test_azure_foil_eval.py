"""azure_foil_eval 검증 — API 없이 판정·집계 로직만 고정한다."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import azure_foil_eval as E  # noqa: E402


def _res(acc, text="x"):
    return {"reason": "RecognizedSpeech", "text": text,
            "pa": {"accuracy": acc, "fluency": 0, "completeness": 0, "pron": 0}}


def test_app_outcome_mirrors_evaluate_from_azure():
    # pronunciationScore.ts: 점수 없음·인식 텍스트 빔 → 채점 불가, 단어는 accuracy >= 60 정답
    assert E.app_outcome(None) == "unscored"
    assert E.app_outcome({"reason": "NoMatch", "text": ""}) == "unscored"
    assert E.app_outcome(_res(95, text="  ")) == "unscored"
    assert E.app_outcome(_res(60)) == "pass"
    assert E.app_outcome(_res(59.9)) == "fail"


def test_threshold_matches_frontend_constant():
    ts = (Path(__file__).resolve().parents[2] / "frontend/src/memory-link/patient/quiz/domain/"
          "pronunciationScore.ts").read_text(encoding="utf-8")
    assert f"good: {E.APP_PASS_ACCURACY}," in ts
    assert "if (mode === 'word') return azure.accuracyScore;" in ts


ROWS = [{"audio": "a.wav", "_wav": Path("a.wav"), "text": "사탕"},
        {"audio": "b.wav", "_wav": Path("b.wav"), "text": "사탕"}]
FOILS = {"사탕": {"foils": [
    {"foil": "사자", "kind": "phon", "counts_for_fa": True, "string_scorer_wrong": False},
    {"foil": "피자", "kind": "sem", "counts_for_fa": True, "string_scorer_wrong": True},
    {"foil": "사통", "kind": "para", "counts_for_fa": False, "string_scorer_wrong": False},
    {"foil": "학교", "kind": "rand", "counts_for_fa": False, "string_scorer_wrong": True},
]}}


def test_build_pairs_filters_kinds():
    pairs = E.build_pairs(ROWS, FOILS, ("phon", "sem"))
    assert [(p["audio"], p["ref"]) for p in pairs] == [
        ("a.wav", "사자"), ("a.wav", "피자"), ("b.wav", "사자"), ("b.wav", "피자")]


def test_summarize_rates_exclude_unscored_from_denominator():
    pairs = E.build_pairs(ROWS, FOILS, ("phon", "sem", "para"))
    k = E.cache_key
    cache = {
        k("a.wav", "사자"): _res(70),          # 통과 → 오통과
        k("b.wav", "사자"): _res(30),
        k("a.wav", "피자"): _res(10),
        k("b.wav", "피자"): {"reason": "NoMatch", "text": ""},   # 채점 불가
        k("a.wav", "사통"): _res(80),
        # b.wav/사통은 아직 안 불렀다 → 집계에서 빠진다
    }
    pos = {"a.wav": _res(90), "b.wav": _res(85)}
    s = E.summarize(pairs, cache, pos)
    near = s["근접(phon+sem)"]
    assert near["n"] == 4 and near["pass"] == 1 and near["unscored"] == 1
    assert abs(near["fa_rate"] - 1 / 3) < 1e-12
    assert s["para"]["n"] == 1 and s["para"]["fa_rate"] == 1.0
    assert s["phon"]["string_scorer_pass"] == 1.0 and s["sem"]["string_scorer_pass"] == 0.0
    assert near["auc"] == 1.0   # 정답 85·90 > foil 70·30·10
    assert E.worst_words(pairs, cache) == [("사자", "사탕", 70)]


def test_verdict_bands():
    assert E.verdict(0.05).startswith("문제없음")
    assert E.verdict(0.0501).startswith("주의")
    assert E.verdict(0.10).startswith("주의")
    assert E.verdict(0.1001).startswith("결함")
    assert E.verdict(float("nan")).startswith("판정 불가")


def test_pair_cache_roundtrip(tmp_path):
    p = tmp_path / "c.jsonl"
    E.AE.append_cache(p, {"audio": "a.wav", "ref": "사자", **_res(70)})
    E.AE.append_cache(p, {"audio": "a.wav", "ref": "피자", **_res(10)})
    c = E.load_pair_cache(p)
    assert set(c) == {E.cache_key("a.wav", "사자"), E.cache_key("a.wav", "피자")}
    assert json.loads(p.read_text(encoding="utf-8").splitlines()[0])["ref"] == "사자"
