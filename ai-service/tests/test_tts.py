"""TTS 서비스·라우터 테스트 (Azure 실호출 없이 엔진 mock).

핵심: (1) 같은 텍스트는 캐시로 재사용돼 엔진이 1회만 호출되고,
(2) 라우터가 audio/mpeg 바이트를 반환하며 빈/과대 텍스트를 거른다.
"""
import main
from dependencies import get_tts_service
from fastapi.testclient import TestClient
from services.tts_service import TtsService


class FakeEngine:
    """ITtsEngine 호환 가짜 엔진 (호출 인자·횟수 기록)."""

    name = "fake"

    def __init__(self, audio: bytes) -> None:
        self._audio = audio
        self.calls: list[tuple[str, str]] = []

    def synthesize(self, text: str, voice: str) -> bytes:
        self.calls.append((text, voice))
        return self._audio


# ── TtsService (캐싱) ─────────────────────────────────────────


def test_service_synthesizes_and_returns_bytes(tmp_path):
    engine = FakeEngine(b"MP3DATA")
    svc = TtsService(engine, str(tmp_path))

    audio = svc.synthesize("바다", "ko-KR-SunHiNeural")

    assert audio == b"MP3DATA"
    assert svc.engine_name == "fake"
    assert engine.calls == [("바다", "ko-KR-SunHiNeural")]


def test_service_caches_same_text(tmp_path):
    engine = FakeEngine(b"MP3DATA")
    svc = TtsService(engine, str(tmp_path))

    first = svc.synthesize("바다", "ko-KR-SunHiNeural")
    second = svc.synthesize("바다", "ko-KR-SunHiNeural")

    assert first == second == b"MP3DATA"
    # 두 번째는 캐시 히트 → 엔진은 1회만 호출
    assert len(engine.calls) == 1
    # 캐시 파일이 생성됨(.mp3 1개, .tmp 잔여 없음)
    files = list(tmp_path.iterdir())
    assert len(files) == 1
    assert files[0].suffix == ".mp3"


def test_service_different_voice_is_separate_cache(tmp_path):
    engine = FakeEngine(b"MP3DATA")
    svc = TtsService(engine, str(tmp_path))

    svc.synthesize("바다", "ko-KR-SunHiNeural")
    svc.synthesize("바다", "ko-KR-InJoonNeural")

    # voice가 다르면 키가 달라 각각 합성
    assert len(engine.calls) == 2


# ── GET /tts ──────────────────────────────────────────────────


def _client_with(service: TtsService) -> TestClient:
    main.app.dependency_overrides[get_tts_service] = lambda: service
    return TestClient(main.app)


def test_tts_endpoint_returns_audio(tmp_path):
    client = _client_with(TtsService(FakeEngine(b"MP3DATA"), str(tmp_path)))
    try:
        resp = client.get("/tts", params={"text": "바다"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"
        assert resp.content == b"MP3DATA"
    finally:
        main.app.dependency_overrides.clear()


def test_tts_endpoint_blank_text_returns_400(tmp_path):
    client = _client_with(TtsService(FakeEngine(b"MP3DATA"), str(tmp_path)))
    try:
        resp = client.get("/tts", params={"text": "   "})
        assert resp.status_code == 400
    finally:
        main.app.dependency_overrides.clear()


def test_tts_endpoint_too_long_returns_413(tmp_path):
    client = _client_with(TtsService(FakeEngine(b"MP3DATA"), str(tmp_path)))
    try:
        resp = client.get("/tts", params={"text": "가" * 501})
        assert resp.status_code == 413
    finally:
        main.app.dependency_overrides.clear()


def test_tts_endpoint_engine_error_returns_502(tmp_path):
    class BrokenEngine(FakeEngine):
        def synthesize(self, text: str, voice: str) -> bytes:
            raise RuntimeError("azure canceled")

    client = _client_with(TtsService(BrokenEngine(b""), str(tmp_path)))
    try:
        resp = client.get("/tts", params={"text": "바다"})
        assert resp.status_code == 502
    finally:
        main.app.dependency_overrides.clear()
