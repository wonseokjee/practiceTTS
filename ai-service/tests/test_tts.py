"""TTS 서비스·라우터 테스트 (Azure 실호출 없이 엔진 mock).

핵심: (1) 같은 텍스트는 캐시로 재사용돼 엔진이 1회만 호출되고,
(2) 라우터가 audio/mpeg 바이트를 반환하며 빈/과대 텍스트를 거른다.
"""
import os

import main
import pytest
from dependencies import get_tts_rate_limiter, get_tts_service
from fastapi.testclient import TestClient

from tests.service_auth_helper import SERVICE_HEADERS
from infra import azure_tts
from infra.azure_tts import (
    ALLOWED_VOICES,
    VOICES_BY_LOCALE,
    AzureTtsEngine,
    locale_of_voice,
    speech_rate_for,
)
from infra.rate_limiter import SlidingWindowRateLimiter
from services.tts_service import TtsService


# ── SSML 이스케이프 (인젝션 방어) ─────────────────────────────


def test_ssml_escapes_text_and_voice():
    ssml = AzureTtsEngine._build_ssml('개 & <고양이>', 'ko-KR-SunHiNeural')
    assert "&amp;" in ssml
    assert "&lt;고양이&gt;" in ssml
    assert "<고양이>" not in ssml  # raw 꺾쇠가 그대로 들어가면 안 됨


def test_ssml_lang_is_derived_from_voice():
    """xml:lang을 박아 두면 영어 음성을 넣어도 엔진이 한국어로 읽는다.

    로케일별 음성을 실제로 넣는 것은 말속도 결정(§7-2) 뒤의 일이라, 여기서는
    **파생이 일어나는지**를 본다. 다국어 음성(HyunsuMultilingual)도 이름은
    ko-KR이라 지금은 ko-KR로 읽는 것이 맞다.
    """
    for voice in sorted(VOICES_BY_LOCALE["ko-KR"]):
        ssml = AzureTtsEngine._build_ssml("바다", voice)
        assert 'xml:lang="ko-KR"' in ssml
        assert f'<voice name="{voice}">' in ssml


def test_ssml_lang_actually_follows_a_non_korean_voice(monkeypatch):
    """**파생이 진짜로 일어나는지**를 본다.

    ko-KR 음성만으로 `xml:lang="ko-KR"`을 확인하면, 값을 다시 박아 넣어도
    테스트가 통과한다(실제로 그렇게 확인해 봤다 — 공허한 단언이었다).
    그래서 말속도 표에 en-US를 임시로 넣어 **다른 로케일에서도 따라가는지**
    본다. 말속도 정책과 xml:lang 파생은 별개 관심사다.
    """
    monkeypatch.setitem(azure_tts.SPEECH_RATE_BY_LOCALE, "en-US", "-5%")
    ssml = AzureTtsEngine._build_ssml("sea", "en-US-AriaNeural")
    assert 'xml:lang="en-US"' in ssml
    assert "ko-KR" not in ssml
    assert 'rate="-5%"' in ssml


def test_ssml_for_unconfigured_locale_raises_instead_of_reading_in_korean():
    """말속도를 안 정한 로케일은 **한국어로 읽어 버리지 않고** 터진다.

    예전에는 xml:lang이 ko-KR로 박혀 있어, 영어 음성을 넣으면 조용히 한국어
    발음으로 읽혔다. 지금은 음성을 추가하려면 말속도를 먼저 정해야 한다.
    """
    with pytest.raises(ValueError):
        AzureTtsEngine._build_ssml("sea", "en-US-AriaNeural")


def test_locale_of_voice():
    assert locale_of_voice("ko-KR-SunHiNeural") == "ko-KR"
    assert locale_of_voice("en-US-AriaNeural") == "en-US"
    with pytest.raises(ValueError):
        locale_of_voice("nonsense")


def test_speech_rate_is_per_locale_and_fails_loudly():
    """-10%는 ko-KR 기준 속도에 대한 값이라 다른 언어로 복사하면 안 된다.

    말속도를 안 정한 로케일은 **조용히 폴백하지 않고** 터져야 한다 —
    화이트리스트에 음성만 넣고 속도를 빠뜨린 실수가 곧바로 드러나야 한다.
    """
    assert speech_rate_for("ko-KR-SunHiNeural") == "-10%"
    with pytest.raises(ValueError):
        speech_rate_for("en-US-AriaNeural")


def test_allowed_voices_matches_locale_map():
    """평평한 화이트리스트가 로케일별 표에서 그대로 유도된다 —
    둘이 갈리면 한쪽에만 음성이 추가돼 검증이 새거나 못 쓰게 된다."""
    flattened = {v for voices in VOICES_BY_LOCALE.values() for v in voices}
    assert flattened == set(ALLOWED_VOICES)


def test_every_allowed_voice_has_a_rate():
    """화이트리스트의 모든 음성이 말속도를 가진다(추가 시 함께 정하도록)."""
    for voice in ALLOWED_VOICES:
        assert speech_rate_for(voice)


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


def test_service_survives_file_deleted_between_check_and_read(tmp_path):
    """축출 스레드가 파일을 지워도 502가 아니라 재합성으로 복구한다.

    FastAPI 동기 엔드포인트는 스레드풀에서 돌기 때문에, 캐시 존재 확인과 읽기
    사이에 축출이 끼어들 수 있다. 그 경합으로 사용자에게 502를 주면 안 된다.
    """
    engine = FakeEngine(b"MP3DATA")
    svc = TtsService(engine, str(tmp_path))
    svc.synthesize("바다", VOICE)  # 캐시 생성

    # 축출이 지운 상황을 재현
    svc._cache_path("바다", VOICE).unlink()

    audio = svc.synthesize("바다", VOICE)

    assert audio == b"MP3DATA"
    assert len(engine.calls) == 2  # 재합성으로 복구


def test_service_evicts_down_to_low_water_not_just_under_cap(tmp_path):
    """상한이 아니라 저수위(80%)까지 지운다.

    상한에 딱 맞춰 지우면 다음 쓰기가 곧바로 상한을 다시 넘겨, 미스마다 O(N)
    디렉토리 스캔이 돌아 캐시가 CPU/IO DoS 벡터가 된다.
    """
    # 10바이트/개, 상한 100 → 저수위 80. 11개(110B) 쓰면 80 이하로 내려가야 한다.
    svc = TtsService(FakeEngine(b"0123456789"), str(tmp_path), max_cache_bytes=100)

    for i in range(11):
        svc.synthesize(f"text-{i}", VOICE)
        os.utime(svc._cache_path(f"text-{i}", VOICE), (100 + i, 100 + i))

    total = sum(p.stat().st_size for p in tmp_path.glob("*.mp3"))
    assert total <= 80  # 상한(100)이 아니라 저수위(80)까지


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
    return TestClient(main.app, headers=SERVICE_HEADERS)


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
        client = TestClient(main.app, headers=SERVICE_HEADERS)
        first = client.get("/tts", params={"text": "바다"})
        second = client.get("/tts", params={"text": "산"})
        assert first.status_code == 200
        assert second.status_code == 429
        # 차단된 요청은 엔진에 도달하지 않는다(합성 1회뿐).
        assert len(engine.calls) == 1
    finally:
        main.app.dependency_overrides.clear()
