"""POST /pronunciation 라우터 테스트 (Azure 실호출 없이 가짜 서비스).

이 파일의 앞부분("현행 계약")은 **경쟁자 기능을 넣기 전의 응답을 그대로 고정한다.**
`competitors`·`stt_competitor`를 안 보내는 요청은 응답의 **키 집합까지** 예전과 같아야
한다 — 응답에 새 키가 하나라도 생기면 기존 클라이언트(백엔드 프록시·프론트)가 보는
계약이 바뀐 것이다. 이 테스트들은 변경 전 코드에서 먼저 통과시킨 뒤 기능을 붙였다.
"""
from fastapi.testclient import TestClient

from tests.service_auth_helper import SERVICE_HEADERS

import main
from dependencies import get_pronunciation_rate_limiter, get_pronunciation_service
from infra.rate_limiter import SlidingWindowRateLimiter
from models.pronunciation import PhonemeScore, PronunciationResult, WordScore
from services.pronunciation_service import PronunciationService


class FakeAssessor:
    name = "fake"

    def __init__(self, result=None, error=None):
        self._result = result or PronunciationResult(
            recognized_text="바다",
            accuracy_score=91.0,
            fluency_score=88.0,
            completeness_score=100.0,
            pronunciation_score=90.0,
            prosody_score=None,
            words=[
                WordScore(
                    word="바다",
                    accuracy=91.0,
                    error_type="None",
                    phonemes=[PhonemeScore(phoneme="b", accuracy=92.0)],
                )
            ],
        )
        self._error = error
        self.calls = []

    def assess(self, wav_bytes, reference_text, lang):
        self.calls.append((reference_text, lang))
        if self._error:
            raise self._error
        return self._result


def client_with(assessor, limiter=None) -> TestClient:
    main.app.dependency_overrides[get_pronunciation_service] = lambda: PronunciationService(assessor)
    if limiter is not None:
        main.app.dependency_overrides[get_pronunciation_rate_limiter] = lambda: limiter
    return TestClient(main.app, headers=SERVICE_HEADERS)


def post(client, data=None, audio=b"RIFF....WAVE"):
    return client.post(
        "/pronunciation",
        files={"audio": ("a.wav", audio, "audio/wav")},
        data={"lang": "ko-KR", "reference_text": "바다", **(data or {})},
    )


# ── 현행 계약 (경쟁자 필드 없이) ──────────────────────────────────


def test_plain_request_response_shape_is_unchanged():
    assessor = FakeAssessor()
    client = client_with(assessor)
    try:
        resp = post(client)
        assert resp.status_code == 200
        body = resp.json()
        # 키 집합이 예전과 정확히 같다 — 새 키가 생기면 여기서 깨진다
        assert set(body) == {
            "recognized_text", "accuracy_score", "fluency_score", "completeness_score",
            "pronunciation_score", "prosody_score", "words", "engine",
        }
        assert body["prosody_score"] is None          # null도 키로 나간다(예전과 같다)
        assert body["engine"] == "fake"
        assert set(body["words"][0]) == {"word", "accuracy", "error_type", "phonemes"}
        assert body["words"][0]["phonemes"] == [{"phoneme": "b", "accuracy": 92.0}]
        assert assessor.calls == [("바다", "ko-KR")]
    finally:
        main.app.dependency_overrides.clear()


def test_plain_request_engine_failure_is_502():
    client = client_with(FakeAssessor(error=RuntimeError("canceled")))
    try:
        assert post(client).status_code == 502
    finally:
        main.app.dependency_overrides.clear()


def test_plain_request_validation():
    client = client_with(FakeAssessor())
    try:
        assert post(client, {"reference_text": "   "}).status_code == 400
        assert post(client, {"reference_text": "가" * 501}).status_code == 413
        assert post(client, audio=b"").status_code == 400
        resp = client.post("/pronunciation", files={"audio": ("a.wav", b"x", "audio/wav")},
                           data={"reference_text": "바다"})
        assert resp.status_code == 422                 # lang은 필수
    finally:
        main.app.dependency_overrides.clear()


def test_plain_request_counts_one_against_the_rate_limit():
    limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=60)
    client = client_with(FakeAssessor(), limiter)
    try:
        assert post(client).status_code == 200
        assert post(client).status_code == 200
        assert post(client).status_code == 429
    finally:
        main.app.dependency_overrides.clear()


# ── 경쟁자 모드 ───────────────────────────────────────────────────
#
# 서비스 로직은 test_competitor_service.py가 본다. 여기서는 라우터가 입력을 검증·정리하고,
# 응답에 경쟁자 필드를 싣고, 한도를 호출 수로 차감하는지를 본다.

import json

import pytest

import dependencies
from dependencies import get_competitor_service
from models.pronunciation import CompetitorAssessment, CompetitorScore

BASE_KEYS = {
    "recognized_text", "accuracy_score", "fluency_score", "completeness_score",
    "pronunciation_score", "prosody_score", "words", "engine",
}


class RecordingCompetitorService:
    """라우터가 넘긴 인자를 기록하고 고정 결과를 돌려준다."""

    def __init__(self, assessment):
        self.assessment = assessment
        self.calls = []

    def assess(self, wav_bytes, reference_text, lang, competitors, want_stt):
        self.calls.append((reference_text, lang, list(competitors), want_stt))
        return self.assessment


def _assessment(**kw):
    target = FakeAssessor()._result
    base = dict(
        target=target,
        competitors=[
            CompetitorScore("구름", "neighbor", 20.0, "구름", "ok"),
            CompetitorScore("노래", "stt", 88.0, "노래", "ok"),
        ],
        stt_transcript="노래", stt_status="ok", skipped_reason=None,
    )
    base.update(kw)
    return CompetitorAssessment(**base)


def competitor_client(recorder, limiter=None) -> TestClient:
    client = client_with(FakeAssessor(), limiter)
    main.app.dependency_overrides[get_competitor_service] = lambda: recorder
    return client


def test_competitor_mode_adds_fields_and_keeps_base_fields():
    rec = RecordingCompetitorService(_assessment())
    client = competitor_client(rec)
    try:
        resp = post(client, {"competitors": json.dumps(["구름"]), "stt_competitor": "true"})
        assert resp.status_code == 200
        body = resp.json()
        assert BASE_KEYS <= set(body)
        assert set(body) - BASE_KEYS == {
            "competitor_scores", "stt_transcript", "stt_status", "competitors_skipped"}
        assert body["competitor_scores"][1] == {
            "text": "노래", "source": "stt", "accuracy_score": 88.0,
            "recognized_text": "노래", "status": "ok"}
        assert (body["stt_transcript"], body["stt_status"]) == ("노래", "ok")
        assert body["competitors_skipped"] is None
        assert rec.calls == [("바다", "ko-KR", ["구름"], True)]
    finally:
        main.app.dependency_overrides.clear()


def test_skipped_response_has_no_competitor_scores_key():
    rec = RecordingCompetitorService(
        _assessment(competitors=None, skipped_reason="target_below_pass"))
    client = competitor_client(rec)
    try:
        body = post(client, {"competitors": json.dumps(["구름"])}).json()
        assert "competitor_scores" not in body
        assert body["competitors_skipped"] == "target_below_pass"
    finally:
        main.app.dependency_overrides.clear()


def test_stt_only_and_neighbors_only_both_enter_competitor_mode():
    rec = RecordingCompetitorService(_assessment())
    client = competitor_client(rec)
    try:
        assert post(client, {"stt_competitor": "true"}).status_code == 200
        assert post(client, {"competitors": json.dumps(["구름"])}).status_code == 200
        assert [c[2:] for c in rec.calls] == [([], True), (["구름"], False)]
    finally:
        main.app.dependency_overrides.clear()


def test_empty_competitors_without_stt_is_a_plain_request():
    rec = RecordingCompetitorService(_assessment())
    client = competitor_client(rec)
    try:
        for data in ({"competitors": "[]"}, {"competitors": ""}, {"stt_competitor": "false"}):
            body = post(client, data).json()
            assert set(body) == BASE_KEYS, data
        assert rec.calls == []                       # 경쟁자 서비스를 부르지 않았다
    finally:
        main.app.dependency_overrides.clear()


def test_competitors_are_cleaned_before_reaching_the_service():
    rec = RecordingCompetitorService(_assessment())
    client = competitor_client(rec)
    try:
        # 빈 항목·공백 항목·목표와 같은 항목(공백·문장부호 무시)·중복은 버리고 순서는 지킨다
        raw = json.dumps(["구름", " ", "바 다", "구름", "가위 "], ensure_ascii=False)   # 원본 5개(상한)
        assert post(client, {"competitors": raw}).status_code == 200
        assert rec.calls[0][2] == ["구름", "가위"]
    finally:
        main.app.dependency_overrides.clear()


@pytest.mark.parametrize("raw", [
    "not json", '{"a": 1}', '"구름"', "[1, 2]", '["구름", 3]',
    json.dumps(["가"] * 6), json.dumps(["가" * 31]),
])
def test_invalid_competitors_is_400(raw):
    rec = RecordingCompetitorService(_assessment())
    client = competitor_client(rec)
    try:
        assert post(client, {"competitors": raw}).status_code == 400
        assert rec.calls == []
    finally:
        main.app.dependency_overrides.clear()


def test_competitor_limits_boundaries_are_accepted():
    rec = RecordingCompetitorService(_assessment())
    client = competitor_client(rec)
    try:
        five = json.dumps(["가", "나", "다", "라", "마"])
        assert post(client, {"competitors": five}).status_code == 200
        assert post(client, {"competitors": json.dumps(["가" * 30])}).status_code == 200
    finally:
        main.app.dependency_overrides.clear()


def test_stt_competitor_must_be_boolean():
    client = competitor_client(RecordingCompetitorService(_assessment()))
    try:
        assert post(client, {"stt_competitor": "maybe"}).status_code == 422
    finally:
        main.app.dependency_overrides.clear()


def test_competitor_mode_charges_the_rate_limit_by_azure_calls():
    # 이웃 3 + STT = 목표 1 + 이웃 3 + STT 1 + STT 전사 1 = 6호출
    limiter = SlidingWindowRateLimiter(max_requests=12, window_seconds=60)
    client = competitor_client(RecordingCompetitorService(_assessment()), limiter)
    try:
        data = {"competitors": json.dumps(["구름", "가위", "노래"]), "stt_competitor": "true"}
        assert post(client, data).status_code == 200      # 6
        assert post(client, data).status_code == 200      # 12
        assert post(client, data).status_code == 429      # 18 > 12
        assert post(client).status_code == 429            # 평범한 요청도 이미 한도다
    finally:
        main.app.dependency_overrides.clear()


def test_competitor_mode_rate_limit_denial_does_not_reach_the_service():
    limiter = SlidingWindowRateLimiter(max_requests=5, window_seconds=60)
    rec = RecordingCompetitorService(_assessment())
    client = competitor_client(rec, limiter)
    try:
        data = {"competitors": json.dumps(["구름", "가위", "노래"]), "stt_competitor": "true"}
        assert post(client, data).status_code == 429      # 6 > 5
        assert rec.calls == []
    finally:
        main.app.dependency_overrides.clear()


# ── 실제 CompetitorService로 이어 붙인 통합 ───────────────────────


class ScriptedAssessor:
    """참조 텍스트별 점수를 돌려주는 엔진(라우터 → CompetitorService → 엔진 전체 경로)."""

    name = "fake"

    def __init__(self, scores):
        self.scores = scores
        self.calls = []

    def assess(self, wav_bytes, reference_text, lang):
        self.calls.append(reference_text)
        acc = self.scores[reference_text]
        return PronunciationResult(
            recognized_text="x" if acc is not None else "", accuracy_score=acc or 0.0,
            fluency_score=0.0, completeness_score=0.0, pronunciation_score=acc or 0.0,
            prosody_score=None, words=[])


def test_end_to_end_without_stt_configured(monkeypatch):
    """STT 설정이 없어도 (1) 평범한 요청은 영향이 없고 (2) 경쟁자 모드는 stt_status=error로 답한다."""
    monkeypatch.delenv("AZURE_SPEECH_KEY", raising=False)
    monkeypatch.delenv("AZURE_SPEECH_REGION", raising=False)
    monkeypatch.setattr(dependencies, "_stt_service", None)   # 싱글턴이 남아 있으면 진짜 엔진이 나간다
    assessor = ScriptedAssessor({"바다": 90.0, "구름": 10.0})
    main.app.dependency_overrides[get_pronunciation_service] = lambda: PronunciationService(assessor)
    client = TestClient(main.app, headers=SERVICE_HEADERS)
    try:
        assert set(post(client).json()) == BASE_KEYS                       # (1)
        body = post(client, {"competitors": json.dumps(["구름"]), "stt_competitor": "true"}).json()
        assert body["stt_status"] == "error" and body["stt_transcript"] is None       # (2)
        assert [c["text"] for c in body["competitor_scores"]] == ["구름"]
        assert body["competitor_scores"][0]["accuracy_score"] == 10.0
    finally:
        main.app.dependency_overrides.clear()
