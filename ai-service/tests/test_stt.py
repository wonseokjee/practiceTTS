"""STT 서비스·라우터 테스트 (Azure 실호출 없이 엔진 mock)."""
from fastapi.testclient import TestClient

from tests.service_auth_helper import SERVICE_HEADERS

import main
from dependencies import get_stt_service
from models.stt import SttNBestItem, SttResult
from services.stt_service import SttService


class FakeEngine:
    """ISttEngine 호환 가짜 엔진 (호출 인자 기록)."""

    name = "fake"

    def __init__(self, result: SttResult) -> None:
        self._result = result
        self.calls: list[tuple[bytes, str, list[str]]] = []

    def recognize(self, wav_bytes, lang, candidates):
        self.calls.append((wav_bytes, lang, candidates))
        return self._result


def _client_with(service: SttService) -> TestClient:
    main.app.dependency_overrides[get_stt_service] = lambda: service
    return TestClient(main.app, headers=SERVICE_HEADERS)


# ── SttService ────────────────────────────────────────────────


def test_service_delegates_to_engine():
    engine = FakeEngine(SttResult("바다", 0.9, [SttNBestItem("바다", 0.9)]))
    svc = SttService(engine)

    result = svc.recognize(b"wav-bytes", "ko-KR", ["바다"])

    assert result.transcript == "바다"
    assert svc.engine_name == "fake"
    assert engine.calls[0] == (b"wav-bytes", "ko-KR", ["바다"])


# ── POST /stt ─────────────────────────────────────────────────


def test_stt_endpoint_returns_transcript_and_passes_candidates():
    engine = FakeEngine(SttResult("바다", 0.8, [SttNBestItem("바다", 0.8)]))
    client = _client_with(SttService(engine))
    try:
        resp = client.post(
            "/stt",
            files={"audio": ("a.wav", b"RIFF....WAVE", "audio/wav")},
            data={"lang": "ko-KR", "candidates": ["바다", "파도"]},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["transcript"] == "바다"
        assert body["engine"] == "fake"
        assert body["nbest"][0]["text"] == "바다"
        # phrase hint(candidates)가 엔진까지 전달됐는지
        assert engine.calls[0][2] == ["바다", "파도"]
    finally:
        main.app.dependency_overrides.clear()


def test_stt_empty_candidates_ok():
    engine = FakeEngine(SttResult("사과", 0.7, []))
    client = _client_with(SttService(engine))
    try:
        resp = client.post(
            "/stt",
            files={"audio": ("a.wav", b"RIFF....WAVE", "audio/wav")},
            data={"lang": "ko-KR"},
        )
        assert resp.status_code == 200
        assert resp.json()["transcript"] == "사과"
        assert engine.calls[0][2] == []
    finally:
        main.app.dependency_overrides.clear()


def test_stt_empty_audio_returns_400():
    client = _client_with(SttService(FakeEngine(SttResult("", 0.0, []))))
    try:
        resp = client.post(
            "/stt",
            files={"audio": ("a.wav", b"", "audio/wav")},
            data={"lang": "ko-KR"},
        )
        assert resp.status_code == 400
    finally:
        main.app.dependency_overrides.clear()


def test_stt_missing_lang_returns_422():
    # 기본값 ko-KR이 있으면 영어 발화가 한국어로 조용히 인식된다 — 빠뜨리면 실패해야 한다.
    client = _client_with(SttService(FakeEngine(SttResult("x", 0.0, []))))
    try:
        resp = client.post(
            "/stt",
            files={"audio": ("a.wav", b"RIFF....WAVE", "audio/wav")},
        )
        assert resp.status_code == 422
    finally:
        main.app.dependency_overrides.clear()
