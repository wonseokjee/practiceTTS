"""TTS 서비스·라우터 테스트 (Azure 실호출 없이 엔진 mock).

핵심: (1) 같은 텍스트는 캐시로 재사용돼 엔진이 1회만 호출되고,
(2) 라우터가 audio/mpeg 바이트를 반환하며 빈/과대 텍스트를 거른다.
"""
import os

import main
from dependencies import get_tts_rate_limiter, get_tts_service
from fastapi.testclient import TestClient
from infra.azure_tts import AzureTtsEngine
from infra.rate_limiter import SlidingWindowRateLimiter
from services.tts_service import TtsService


# ── SSML 이스케이프 (인젝션 방어) ─────────────────────────────


def test_ssml_escapes_text_and_voice():
    ssml = AzureTtsEngine._build_ssml('개 & <고양이>', 'ko-KR-SunHiNeural')
    assert "&amp;" in ssml
    assert "&lt;고양이&gt;" in ssml
    assert "<고양이>" not in ssml  # raw 꺾쇠가 그대로 들어가면 안 됨


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


# ── 캐시 축출(LRU, 디스크 DoS 방어) ───────────────────────────

VOICE = "ko-KR-SunHiNeural"


def test_service_evicts_oldest_over_cap(tmp_path):
    # 10바이트/개, 상한 25바이트 → 2개까지 보관, 3번째에서 가장 오래된 것 축출
    svc = TtsService(FakeEngine(b"0123456789"), str(tmp_path), max_cache_bytes=25)

    svc.synthesize("a", VOICE)
    os.utime(svc._cache_path("a", VOICE), (100, 100))  # a가 가장 오래됨
    svc.synthesize("b", VOICE)
    os.utime(svc._cache_path("b", VOICE), (101, 101))
    svc.synthesize("c", VOICE)  # 이 시점 총 30B > 25B → a 축출

    assert not svc._cache_path("a", VOICE).exists()
    assert svc._cache_path("b", VOICE).exists()
    assert svc._cache_path("c", VOICE).exists()
    total = sum(p.stat().st_size for p in tmp_path.glob("*.mp3"))
    assert total <= 25


def test_service_unlimited_cache_keeps_all(tmp_path):
    # 상한 None(기본) → 축출 없음
    svc = TtsService(FakeEngine(b"0123456789"), str(tmp_path))
    for text in ["a", "b", "c", "d", "e"]:
        svc.synthesize(text, VOICE)
    assert len(list(tmp_path.glob("*.mp3"))) == 5


def test_service_cache_hit_touches_mtime(tmp_path):
    # 히트 시 mtime 갱신으로 LRU가 '최근 사용'을 반영
    svc = TtsService(FakeEngine(b"MP3DATA"), str(tmp_path))
    svc.synthesize("바다", VOICE)
    path = svc._cache_path("바다", VOICE)
    os.utime(path, (100, 100))
    svc.synthesize("바다", VOICE)  # 캐시 히트 → touch
    assert path.stat().st_mtime > 100


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


def test_tts_endpoint_rejects_unknown_voice(tmp_path):
    """voice는 SSML에 들어가므로 화이트리스트 밖(인젝션 시도 포함)은 400."""
    engine = FakeEngine(b"MP3DATA")
    client = _client_with(TtsService(engine, str(tmp_path)))
    try:
        resp = client.get(
            "/tts",
            params={"text": "바다", "voice": 'x"><audio src="http://evil"/>'},
        )
        assert resp.status_code == 400
        # 엔진까지 도달하지 않아야 한다.
        assert engine.calls == []
    finally:
        main.app.dependency_overrides.clear()


def test_tts_endpoint_accepts_whitelisted_voice(tmp_path):
    engine = FakeEngine(b"MP3DATA")
    client = _client_with(TtsService(engine, str(tmp_path)))
    try:
        resp = client.get(
            "/tts", params={"text": "바다", "voice": "ko-KR-InJoonNeural"}
        )
        assert resp.status_code == 200
        assert engine.calls[0][1] == "ko-KR-InJoonNeural"
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


def test_tts_endpoint_rate_limited_returns_429(tmp_path):
    """한도 초과 시 429 — 임의 텍스트 폭주로 Azure 할당량 소진 방어."""
    engine = FakeEngine(b"MP3DATA")
    main.app.dependency_overrides[get_tts_service] = lambda: TtsService(
        engine, str(tmp_path)
    )
    # 한도 1회/분으로 좁혀 두 번째 요청이 차단되는지 확인.
    # (요청마다 동일 인스턴스를 반환해야 카운트가 누적됨 — 프로덕션은 싱글턴)
    limiter = SlidingWindowRateLimiter(1, 60.0)
    main.app.dependency_overrides[get_tts_rate_limiter] = lambda: limiter
    try:
        client = TestClient(main.app)
        first = client.get("/tts", params={"text": "바다"})
        second = client.get("/tts", params={"text": "산"})
        assert first.status_code == 200
        assert second.status_code == 429
        # 차단된 요청은 엔진에 도달하지 않는다(합성 1회뿐).
        assert len(engine.calls) == 1
    finally:
        main.app.dependency_overrides.clear()
