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
