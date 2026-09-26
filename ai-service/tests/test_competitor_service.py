"""CompetitorService 테스트 — 목표 + 경쟁자 채점 (Azure 실호출 없이 가짜 서비스).

설계: docs/history/20260926_NeighborScoring_design.md, 계획 PR 2.
"""
import re
import threading
import time
from pathlib import Path

import pytest
from fastapi import HTTPException

from models.pronunciation import PronunciationResult
from models.stt import SttResult
from services.competitor_service import (
    COMPETITOR_SKIP_BELOW,
    MAX_COMPETITORS,
    CompetitorService,
    compact,
    max_azure_calls,
    normalize,
)


def _pa(text="x", acc=80.0):
    return PronunciationResult(
        recognized_text=text, accuracy_score=acc, fluency_score=0.0,
        completeness_score=0.0, pronunciation_score=acc, prosody_score=None, words=[],
    )


NO_MATCH = _pa(text="", acc=0.0)


class FakePron:
    """참조 텍스트별로 정해 둔 결과(또는 예외)를 돌려주는 가짜 PronunciationService."""

    def __init__(self, table, default=None, barrier_refs=None, barrier=None, delay=0.0):
        self.table = table
        self.default = default
        self.calls: list[str] = []
        self._lock = threading.Lock()
        self._barrier_refs = barrier_refs or set()
        self._barrier = barrier
        self._delay = delay

    def assess(self, wav_bytes, reference_text, lang):
        with self._lock:
            self.calls.append(reference_text)
        if self._barrier is not None and reference_text in self._barrier_refs:
            self._barrier.wait(timeout=3)     # 순차 호출이면 여기서 BrokenBarrierError
        if self._delay:
            time.sleep(self._delay)
        r = self.table.get(reference_text, self.default)
        if isinstance(r, Exception):
            raise r
        if r is None:
            raise AssertionError(f"예상 밖의 참조: {reference_text!r}")
        return r


class FakeStt:
    def __init__(self, transcript="", error=None):
        self.transcript, self.error = transcript, error
        self.calls: list[list[str]] = []

    def recognize(self, wav_bytes, lang, candidates):
        self.calls.append(list(candidates))
        if self.error:
            raise self.error
        return SttResult(transcript=self.transcript, confidence=0.9, nbest=[])


def svc(pron, stt=None):
    return CompetitorService(pron, stt_provider=lambda: stt if stt is not None else FakeStt())


def run(pron, stt, competitors, want_stt, reference="고래"):
    return svc(pron, stt).assess(b"wav", reference, "ko-KR", competitors, want_stt)


# ── 정상 경로 ─────────────────────────────────────────────────


def test_scores_neighbors_and_stt_transcript_and_calls_stt_without_candidates():
    pron = FakePron({"고래": _pa("고래", 90), "구름": _pa("구름", 20),
                     "가위": _pa("가위", 30), "노래": _pa("노래", 88)})
    stt = FakeStt("노래")
    a = run(pron, stt, ["구름", "가위"], want_stt=True)

    assert a.target.accuracy_score == 90 and a.skipped_reason is None
    assert [(c.text, c.source, c.accuracy_score, c.status) for c in a.competitors] == [
        ("구름", "neighbor", 20, "ok"), ("가위", "neighbor", 30, "ok"), ("노래", "stt", 88, "ok")]
    assert (a.stt_transcript, a.stt_status) == ("노래", "ok")
    # 후보(phrase hint) 없이 불렀다 — 목표를 힌트로 주면 인식이 목표 쪽으로 끌린다
    assert stt.calls == [[]]
    assert sorted(pron.calls) == sorted(["고래", "구름", "가위", "노래"])


def test_without_stt_the_provider_is_never_touched():
    def boom():
        raise AssertionError("STT 서비스를 만들면 안 된다")
    pron = FakePron({"고래": _pa("고래", 90), "구름": _pa("구름", 10)})
    a = CompetitorService(pron, stt_provider=boom).assess(b"w", "고래", "ko-KR", ["구름"], False)
    assert a.stt_status is None and a.stt_transcript is None
    assert [c.text for c in a.competitors] == ["구름"]


def test_calls_run_in_parallel_within_each_stage():
    # 이웃 셋이 **동시에** 떠 있어야 배리어가 열린다. 순차 호출이면 타임아웃 → error 상태로 드러난다.
    barrier = threading.Barrier(3)
    pron = FakePron({"고래": _pa("고래", 90), **{n: _pa(n, 10) for n in ("구름", "가위", "노래")}},
                    barrier_refs={"구름", "가위", "노래"}, barrier=barrier)
    a = run(pron, None, ["구름", "가위", "노래"], want_stt=False)
    assert [c.status for c in a.competitors] == ["ok", "ok", "ok"]


def test_target_and_stt_run_in_parallel_in_stage_one():
    barrier = threading.Barrier(2)
    pron = FakePron({"고래": _pa("고래", 90)}, barrier_refs={"고래"}, barrier=barrier)

    class BarrierStt(FakeStt):
        def recognize(self, wav_bytes, lang, candidates):
            barrier.wait(timeout=3)
            return SttResult(transcript="", confidence=0.0, nbest=[])
    a = run(pron, BarrierStt(), [], want_stt=True)
    assert a.stt_status == "empty" and a.target.accuracy_score == 90


# ── 건너뛰기 ──────────────────────────────────────────────────


def test_target_below_pass_skips_competitors_but_still_reports_stt():
    pron = FakePron({"고래": _pa("고래", 59.9)})
    a = run(pron, FakeStt("노래"), ["구름"], want_stt=True)
    assert a.skipped_reason == "target_below_pass" and a.competitors is None
    assert pron.calls == ["고래"]                       # 경쟁자를 채점하지 않았다
    assert (a.stt_transcript, a.stt_status) == ("노래", "ok")


def test_target_at_threshold_is_not_skipped():
    pron = FakePron({"고래": _pa("고래", COMPETITOR_SKIP_BELOW), "구름": _pa("구름", 5)})
    a = run(pron, None, ["구름"], want_stt=False)
    assert a.skipped_reason is None and len(a.competitors) == 1


def test_target_no_match_skips_competitors():
    pron = FakePron({"고래": NO_MATCH})
    a = run(pron, None, ["구름"], want_stt=False)
    assert a.skipped_reason == "no_match" and a.competitors is None and pron.calls == ["고래"]


# ── STT 전사 처리 ─────────────────────────────────────────────


def test_transcript_equal_to_target_adds_no_competitor_and_no_extra_call():
    pron = FakePron({"고래": _pa("고래", 90), "구름": _pa("구름", 10)})
    a = run(pron, FakeStt("고 래."), ["구름"], want_stt=True)     # 정규화하면 목표와 같다
    assert [c.source for c in a.competitors] == ["neighbor"]
    assert a.stt_status == "ok" and pron.calls.count("고 래") == 0
    assert sorted(pron.calls) == ["고래", "구름"]


def test_transcript_equal_to_a_neighbor_reuses_its_score_without_a_second_call():
    pron = FakePron({"고래": _pa("고래", 90), "노래": _pa("노래", 77)})
    a = run(pron, FakeStt("노래"), ["노래"], want_stt=True)
    assert [(c.text, c.source, c.accuracy_score) for c in a.competitors] == [
        ("노래", "neighbor", 77), ("노래", "stt", 77)]     # stt 항목이 항상 하나 있다
    assert pron.calls.count("노래") == 1                    # PA는 한 번만 불렀다


def test_empty_transcript_adds_no_competitor():
    pron = FakePron({"고래": _pa("고래", 90)})
    a = run(pron, FakeStt(" . "), [], want_stt=True)
    assert a.stt_status == "empty" and a.competitors == []


def test_stt_failure_is_reported_and_does_not_fail_the_request():
    pron = FakePron({"고래": _pa("고래", 90), "구름": _pa("구름", 10)})
    a = run(pron, FakeStt(error=RuntimeError("canceled")), ["구름"], want_stt=True)
    assert a.stt_status == "error" and a.stt_transcript is None
    assert [c.text for c in a.competitors] == ["구름"] and a.target.accuracy_score == 90


def test_stt_not_configured_503_is_reported_as_stt_error():
    def unconfigured():
        raise HTTPException(status_code=503, detail="STT_NOT_CONFIGURED")
    pron = FakePron({"고래": _pa("고래", 90)})
    a = CompetitorService(pron, stt_provider=unconfigured).assess(b"w", "고래", "ko-KR", [], True)
    assert a.stt_status == "error" and a.target.accuracy_score == 90


# ── 경쟁자 실패·무매치 ────────────────────────────────────────


def test_one_competitor_failing_marks_only_that_one_as_error():
    pron = FakePron({"고래": _pa("고래", 90), "구름": RuntimeError("canceled"), "가위": _pa("가위", 30)})
    a = run(pron, None, ["구름", "가위"], want_stt=False)
    assert [(c.text, c.status) for c in a.competitors] == [("구름", "error"), ("가위", "ok")]
    assert a.competitors[0].accuracy_score == 0.0 and a.competitors[0].recognized_text == ""


def test_competitor_no_match_is_scored_zero_not_error():
    pron = FakePron({"고래": _pa("고래", 90), "구름": NO_MATCH})
    a = run(pron, None, ["구름"], want_stt=False)
    assert (a.competitors[0].status, a.competitors[0].accuracy_score) == ("no_match", 0.0)


def test_target_failure_propagates():
    pron = FakePron({"고래": RuntimeError("Azure 발음 평가 실패")})
    with pytest.raises(RuntimeError):
        run(pron, FakeStt("노래"), ["구름"], want_stt=True)


def test_too_many_competitors_is_rejected():
    with pytest.raises(ValueError):
        run(FakePron({}), None, [str(i) for i in range(MAX_COMPETITORS + 1)], want_stt=False)


# ── 보조 함수 · 계약 ──────────────────────────────────────────


def test_max_azure_calls_counts_target_neighbors_and_stt_pair():
    assert max_azure_calls(0, False) == 1
    assert max_azure_calls(3, False) == 4
    assert max_azure_calls(3, True) == 6      # 목표 1 + 이웃 3 + STT 1 + STT 전사 1
    assert max_azure_calls(0, True) == 3


def test_normalize_and_compact_match_stage0_measurement():
    assert normalize("  노래.  ") == "노래"
    assert normalize("고 래!") == "고 래" and compact("고 래!") == "고래"
    assert normalize(None) == "" and compact("...") == ""


def test_skip_threshold_equals_frontend_pass_line():
    """프론트의 정답선(AZURE_GRADE_THRESHOLDS.good)과 같아야 한다.

    이 값이 프론트보다 **낮으면** 프론트가 정답 후보로 보는 목표에서 경쟁자를 안 불러 판정이
    채점 불가로 샌다. 높으면 호출이 낭비된다. 어느 쪽이든 바뀌면 여기서 알아챈다.
    """
    ts = Path(__file__).resolve().parents[2] / (
        "frontend/src/memory-link/patient/quiz/domain/pronunciationScore.ts")
    if not ts.exists():
        pytest.skip("프론트 소스가 없다(ai-service만 배포된 환경)")
    m = re.search(r"good:\s*(\d+),", ts.read_text(encoding="utf-8"))
    assert m, "pronunciationScore.ts에서 good 문턱을 못 찾았다 — 선언 모양이 바뀌었나?"
    assert COMPETITOR_SKIP_BELOW == float(m.group(1))
