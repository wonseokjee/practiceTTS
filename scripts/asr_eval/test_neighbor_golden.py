"""이웃 비교 판정 골든 벡터 — TS(앱) ↔ Python(0단계 실측 코드)의 계약.

정본은 `frontend/.../domain/neighborScoring.ts`(앱이 실제로 쓰는 판정)이고, 이 저장소의 0단계
실측(`azure_neighbor_eval.py` — 오통과 3.5%·모호율 13.0%)은 그 규칙의 **재현본**이다. 앱 규칙이
바뀌면 그 수치는 앱에 대한 근거가 못 된다. 그래서 입력·출력 쌍을 `golden/neighbor_decisions.json`에
얼려 두고, Vitest(`neighborScoringGolden.test.ts`)와 이 테스트가 각자 재현하는지 본다.

벡터를 고치는 법(= 판정 규칙을 의도적으로 바꿀 때):
    UPDATE_GOLDEN=1 npx vitest run src/memory-link/patient/quiz/domain/neighborScoringGolden.test.ts
그다음 이 테스트가 빨개지면 `azure_neighbor_eval.py`를 같이 고친다 — 한쪽만 바꾸면 반드시 빨간불이다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import azure_neighbor_eval as E  # noqa: E402

VECTORS = json.loads(
    (Path(__file__).parent / "golden" / "neighbor_decisions.json").read_text(encoding="utf-8"))


def _competitor_result(entry: dict) -> dict:
    """서버 응답 항목 → 실측 코드가 다루는 Azure 결과 dict."""
    if entry["status"] == "ok":
        return {"reason": "RecognizedSpeech", "text": entry["text"], "pa": {"accuracy": entry["accuracy"]}}
    if entry["status"] == "no_match":
        return {"reason": "NoMatch", "text": ""}
    return {"reason": "Canceled"}   # error = 호출 실패


def _replay(case: dict) -> str:
    """실측 코드가 이 사례를 어떻게 판정하는가 — `plan()`이 경쟁자를 모으는 방식 그대로."""
    target_res = {"reason": "RecognizedSpeech", "text": case["targetText"],
                  "pa": {"accuracy": case["targetAccuracy"]}}
    comps = [
        _competitor_result(e) for e in case["competitors"]
        # STT 경쟁자는 정답으로 보는 변형(사과요·부분 명칭)이면 경쟁자로 안 쓴다
        if not (e["source"] == "stt" and E.is_accepted_variant(e["text"], case["target"]))
    ]
    return E.decide(target_res, comps)


def test_pass_line_and_partial_ratio_match_frozen_values():
    assert E.FE.APP_PASS_ACCURACY == VECTORS["passLine"]
    assert E.PARTIAL_MIN_RATIO == VECTORS["partialMinRatio"]


@pytest.mark.parametrize("v", VECTORS["variants"], ids=lambda v: f"{v['said']!r}<-{v['target']!r}")
def test_accepted_variant_matches_frozen_vector(v):
    assert E.is_accepted_variant(v["said"], v["target"]) is v["accepted"]


_MODELLED = [d for d in VECTORS["decisions"] if d["pythonModelled"]]


@pytest.mark.parametrize("case", _MODELLED, ids=lambda d: d["name"])
def test_decision_matches_frozen_vector(case):
    assert _replay(case) == case["verdict"]


def test_unmodelled_cases_are_only_the_ones_the_offline_measurement_cannot_express():
    """캐시로 돌리는 실측에는 호출 실패·건너뜀·응답 누락이 없다 — 그 사례만 Python 검증에서 빠진다."""
    skipped = [d for d in VECTORS["decisions"] if not d["pythonModelled"]]
    assert skipped, "벡터에 모델링 안 되는 사례가 하나도 없다 — 표시가 잘못됐나?"
    for d in skipped:
        assert d["sttStatus"] in ("error", None) or d["competitors"] is None, d["name"]


def test_all_four_verdicts_are_exercised_by_python():
    assert {d["verdict"] for d in _MODELLED} == {"pass", "fail", "ambiguous", "unscored"}
